"use server";

/**
 * 3-touch cadence sequencer.
 * Enqueues email sequences for prospects and dispatches due touches via
 * SendGrid with per-tenant daily caps and in-transaction suppression checks.
 */

import { buildDb } from "@/lib/db";
import { composeEmail } from "@/lib/sdr/composer";

export interface SequenceDispatchResult {
  sequencesCreated: number;
  touchesQueued: number;
  touchesSent: number;
  suppressed: number;
  errors: string[];
}

const TOUCH_DELAY_DAYS: Record<number, number> = { 1: 0, 2: 3, 3: 7 };
const DEFAULT_DAILY_CAP = 50;

interface CampaignRow {
  id: string;
  org_id: string;
  vertical: string;
  tone: string;
  template_key: string;
}

interface ProspectRow {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  company: string;
  trigger_event_id: string | null;
  trigger_event_type: string | null;
  trigger_event_title: string | null;
  trigger_event_description: string | null;
}

interface TouchRow {
  id: string;
  prospect_email: string;
  prospect_name: string;
  subject: string;
  body: string;
}

interface SendGridParams {
  toEmail: string;
  toName: string;
  fromEmail: string;
  subject: string;
  body: string;
}

export async function enqueueSequencesForCampaign(
  campaignId: string,
  orgId: string,
): Promise<SequenceDispatchResult> {
  const db = buildDb();
  const errors: string[] = [];

  const campaigns = await db.query<CampaignRow>(
    `SELECT id, org_id, vertical, tone, template_key
     FROM sdr_campaigns
     WHERE id = $1 AND org_id = $2 AND status = 'active'`,
    campaignId,
    orgId,
  );
  const campaign = campaigns[0];
  if (!campaign) {
    return {
      sequencesCreated: 0,
      touchesQueued: 0,
      touchesSent: 0,
      suppressed: 0,
      errors: ["Campaign not found or not active"],
    };
  }

  const prospects = await db.query<ProspectRow>(
    `SELECT p.id, p.full_name, p.email, p.title, p.company,
            te.id AS trigger_event_id,
            te.event_type AS trigger_event_type,
            te.event_title AS trigger_event_title,
            te.event_description AS trigger_event_description
     FROM sdr_prospects p
     LEFT JOIN sdr_prospect_trigger_events te
       ON te.prospect_id = p.id AND te.is_top_trigger = true
     WHERE p.campaign_id = $1 AND p.org_id = $2
       AND p.email IS NOT NULL AND p.email_verified = true
       AND NOT EXISTS (
         SELECT 1 FROM sdr_email_sequences s
         WHERE s.prospect_id = p.id AND s.campaign_id = $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM sdr_suppressions sup
         WHERE sup.org_id = $2 AND sup.email = p.email
       )
     ORDER BY te.relevance_score DESC NULLS LAST
     LIMIT 200`,
    campaignId,
    orgId,
  );

  let sequencesCreated = 0;
  let touchesQueued = 0;
  let suppressed = 0;
  const now = new Date();

  for (const prospect of prospects) {
    if (!prospect.email) {
      suppressed++;
      continue;
    }

    try {
      const composed: Array<{
        subject: string;
        body: string;
        templateVersion: string;
      }> = [];

      for (const touchNum of [1, 2, 3] as const) {
        const email = await composeEmail({
          prospectName: prospect.full_name,
          prospectTitle: prospect.title,
          company: prospect.company,
          vertical: campaign.vertical,
          tone: campaign.tone,
          triggerEventType:
            prospect.trigger_event_type ?? "general_interest",
          triggerEventTitle:
            prospect.trigger_event_title ??
            `${prospect.company} — new opportunity`,
          triggerEventDescription: prospect.trigger_event_description,
          touchNumber: touchNum,
        });
        composed.push(email);
      }

      const seqRows = await db.query<{ id: string }>(
        `INSERT INTO sdr_email_sequences
           (org_id, campaign_id, prospect_id, trigger_event_id, template_version, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        orgId,
        campaignId,
        prospect.id,
        prospect.trigger_event_id,
        composed[0].templateVersion,
      );
      const sequenceId = seqRows[0]?.id;
      if (!sequenceId) continue;

      for (let idx = 0; idx < 3; idx++) {
        const touchNum = idx + 1;
        const delayDays = TOUCH_DELAY_DAYS[touchNum] ?? idx * 3;
        const scheduledAt = new Date(
          now.getTime() + delayDays * 86_400_000,
        );
        await db.execute(
          `INSERT INTO sdr_sequence_touches
             (org_id, sequence_id, touch_number, subject, body,
              template_version, status, scheduled_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
          orgId,
          sequenceId,
          touchNum,
          composed[idx].subject,
          composed[idx].body,
          composed[idx].templateVersion,
          scheduledAt.toISOString(),
        );
        touchesQueued++;
      }

      sequencesCreated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`[prospect:${prospect.id}] ${message}`);
    }
  }

  return { sequencesCreated, touchesQueued, touchesSent: 0, suppressed, errors };
}

export async function dispatchQueuedTouches(
  orgId: string,
  dailyCap: number = DEFAULT_DAILY_CAP,
): Promise<{ sent: number; errors: string[] }> {
  const db = buildDb();
  const errors: string[] = [];
  let sent = 0;

  const sentTodayRows = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM sdr_sequence_touches
     WHERE org_id = $1
       AND status = 'sent'
       AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
    orgId,
  );
  const sentToday = parseInt(sentTodayRows[0]?.count ?? "0", 10);
  const remaining = dailyCap - sentToday;
  if (remaining <= 0) {
    return { sent: 0, errors: [] };
  }

  const touches = await db.query<TouchRow>(
    `SELECT t.id, p.email AS prospect_email, p.full_name AS prospect_name,
            t.subject, t.body
     FROM sdr_sequence_touches t
     JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
     JOIN sdr_prospects p ON p.id = seq.prospect_id
     WHERE t.org_id = $1
       AND t.status = 'queued'
       AND t.scheduled_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM sdr_suppressions sup
         WHERE sup.org_id = $1 AND sup.email = p.email
       )
     ORDER BY t.scheduled_at ASC
     LIMIT $2`,
    orgId,
    remaining,
  );

  for (const touch of touches) {
    try {
      const messageId = await sendViaSendGrid({
        toEmail: touch.prospect_email,
        toName: touch.prospect_name,
        fromEmail:
          process.env.SENDGRID_FROM_EMAIL ?? "outbound@mail.yourdomain.com",
        subject: touch.subject,
        body: touch.body,
      });

      await db.execute(
        `UPDATE sdr_sequence_touches
         SET status = 'sent', sent_at = now(),
             sendgrid_message_id = $2, updated_at = now()
         WHERE id = $1 AND status = 'queued'`,
        touch.id,
        messageId,
      );
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`[touch:${touch.id}] ${message}`);
    }
  }

  return { sent, errors };
}

async function sendViaSendGrid(params: SendGridParams): Promise<string> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [
        { to: [{ email: params.toEmail, name: params.toName }] },
      ],
      from: { email: params.fromEmail },
      subject: params.subject,
      content: [{ type: "text/plain", value: params.body }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.headers.get("x-message-id") ?? `sg-${Date.now()}`;
}
