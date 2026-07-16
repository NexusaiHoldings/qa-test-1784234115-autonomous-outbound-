/**
 * Agent tool handler: send_sequence_touch
 *
 * Confirm-gated mutation. Dispatches one sequence touch via SendGrid after an
 * in-transaction suppression check and daily send-cap check. Called by the
 * sequence dispatcher when a touch comes due.
 *
 * Autonomy = confirm — routes through the cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

interface Args {
  touch_id: string;
  org_id: string;
  prospect_id: string;
  campaign_id: string;
  sequence_step: number;
  subject: string;
  body_html: string;
  body_text: string;
}

interface ProspectRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
}

interface TouchRow {
  id: string;
  status: string;
  scheduled_at: string;
}

interface SendCapRow {
  sent_today: string;
}

interface SuppressionRow {
  email: string;
}

interface SendGridResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
}

const DAILY_SEND_CAP = parseInt(process.env.SDR_DAILY_SEND_CAP ?? "500", 10);

async function dispatchViaSendGrid(
  toEmail: string,
  toName: string | null,
  subject: string,
  bodyHtml: string,
  bodyText: string,
  orgId: string
): Promise<{ messageId: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }
  const fromEmail = process.env.SDR_SENDING_FROM_EMAIL ?? process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error("SDR_SENDING_FROM_EMAIL or SENDGRID_FROM_EMAIL env var is required");
  }

  const payload = {
    personalizations: [
      {
        to: [{ email: toEmail, name: toName ?? undefined }],
      },
    ],
    from: { email: fromEmail },
    subject,
    content: [
      { type: "text/plain", value: bodyText },
      { type: "text/html", value: bodyHtml },
    ],
    custom_args: { org_id: orgId },
    tracking_settings: {
      click_tracking: { enable: true },
      open_tracking: { enable: true },
    },
  };

  const response = (await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })) as SendGridResponse;

  if (!response.ok) {
    throw new Error(`SendGrid API error: HTTP ${response.status}`);
  }

  const messageId = response.headers.get("X-Message-Id") ?? crypto.randomUUID();
  return { messageId };
}

export async function handleSendSequenceTouch(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const {
    touch_id,
    org_id,
    prospect_id,
    campaign_id,
    sequence_step,
    subject,
    body_html,
    body_text,
  } = args as unknown as Args;

  if (!touch_id || typeof touch_id !== "string") {
    return { status: 400, body: "touch_id is required" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { status: 400, body: "org_id is required" };
  }
  if (!prospect_id || typeof prospect_id !== "string") {
    return { status: 400, body: "prospect_id is required" };
  }
  if (!campaign_id || typeof campaign_id !== "string") {
    return { status: 400, body: "campaign_id is required" };
  }
  if (!subject || typeof subject !== "string") {
    return { status: 400, body: "subject is required" };
  }
  if (!body_html || typeof body_html !== "string") {
    return { status: 400, body: "body_html is required" };
  }
  if (!body_text || typeof body_text !== "string") {
    return { status: 400, body: "body_text is required" };
  }

  // Load the touch record and verify it belongs to this org + is pending
  const touchRows = await ctx.db.query<TouchRow>(
    `SELECT id, status, scheduled_at
       FROM sdr_sequence_touches
      WHERE id = $1 AND org_id = $2`,
    touch_id,
    org_id
  );
  const touch = touchRows[0];
  if (!touch) {
    return { status: 404, body: "Sequence touch not found" };
  }
  if (touch.status !== "pending" && touch.status !== "scheduled") {
    return {
      status: 409,
      body: `Touch already in terminal state: ${touch.status}`,
    };
  }

  // Load the prospect
  const prospectRows = await ctx.db.query<ProspectRow>(
    `SELECT id, email, first_name, last_name, status
       FROM sdr_prospects
      WHERE id = $1 AND org_id = $2 AND campaign_id = $3`,
    prospect_id,
    org_id,
    campaign_id
  );
  const prospect = prospectRows[0];
  if (!prospect) {
    return { status: 404, body: "Prospect not found for this campaign" };
  }
  if (!prospect.email) {
    await ctx.db.execute(
      `UPDATE sdr_sequence_touches
          SET status = 'skipped', skip_reason = 'no_email', updated_at = NOW()
        WHERE id = $1`,
      touch_id
    );
    return { status: 422, body: "Prospect has no email address; touch skipped" };
  }
  if (prospect.status === "unsubscribed" || prospect.status === "bounced") {
    await ctx.db.execute(
      `UPDATE sdr_sequence_touches
          SET status = 'skipped', skip_reason = $2, updated_at = NOW()
        WHERE id = $1`,
      touch_id,
      prospect.status
    );
    return {
      status: 422,
      body: `Prospect status is ${prospect.status}; touch skipped`,
    };
  }

  // Suppression check — consult the org-scoped suppression list
  const suppressionRows = await ctx.db.query<SuppressionRow>(
    `SELECT email
       FROM sdr_suppression_list
      WHERE org_id = $1 AND email = $2
      LIMIT 1`,
    org_id,
    prospect.email.toLowerCase()
  );
  if (suppressionRows.length > 0) {
    await ctx.db.execute(
      `UPDATE sdr_sequence_touches
          SET status = 'skipped', skip_reason = 'suppressed', updated_at = NOW()
        WHERE id = $1`,
      touch_id
    );
    return {
      status: 422,
      body: `Email ${prospect.email} is on the suppression list; touch skipped`,
    };
  }

  // Daily send-cap check — count touches sent today for this org
  const capRows = await ctx.db.query<SendCapRow>(
    `SELECT COUNT(*) AS sent_today
       FROM sdr_sequence_touches
      WHERE org_id = $1
        AND status = 'sent'
        AND sent_at >= CURRENT_DATE
        AND sent_at < CURRENT_DATE + INTERVAL '1 day'`,
    org_id
  );
  const sentToday = parseInt(capRows[0]?.sent_today ?? "0", 10);
  if (sentToday >= DAILY_SEND_CAP) {
    return {
      status: 429,
      body: `Daily send cap of ${DAILY_SEND_CAP} reached (${sentToday} sent today); touch deferred`,
    };
  }

  // Mark as in-flight to prevent duplicate sends under concurrent invocations
  await ctx.db.execute(
    `UPDATE sdr_sequence_touches
        SET status = 'sending', updated_at = NOW()
      WHERE id = $1 AND status IN ('pending','scheduled')`,
    touch_id
  );

  // Dispatch via SendGrid
  let messageId: string;
  try {
    const toName =
      [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || null;
    const result = await dispatchViaSendGrid(
      prospect.email,
      toName,
      subject,
      body_html,
      body_text,
      org_id
    );
    messageId = result.messageId;
  } catch (error) {
    // Roll back to pending so the dispatcher can retry
    await ctx.db.execute(
      `UPDATE sdr_sequence_touches
          SET status = 'pending', updated_at = NOW()
        WHERE id = $1`,
      touch_id
    );
    return {
      status: 502,
      body: `SendGrid dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Record successful send
  await ctx.db.execute(
    `UPDATE sdr_sequence_touches
        SET status = 'sent',
            sent_at = NOW(),
            sendgrid_message_id = $2,
            updated_at = NOW()
      WHERE id = $1`,
    touch_id,
    messageId
  );

  return {
    status: 200,
    body: {
      touch_id,
      prospect_id,
      campaign_id,
      sequence_step: sequence_step ?? null,
      to_email: prospect.email,
      sendgrid_message_id: messageId,
      sent_today: sentToday + 1,
      daily_cap: DAILY_SEND_CAP,
      message: `Sequence touch sent to ${prospect.email}`,
    },
  };
}
