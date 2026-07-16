/**
 * SendGrid Inbound Parse webhook handler.
 *
 * SendGrid posts multipart/form-data to this URL when a prospect replies
 * to a sequence touch. This handler:
 *   1. Extracts the sender email from the From field
 *   2. Looks up the matching prospect + latest sent touch
 *   3. Calls the reply-intent classifier (gpt-5.4-mini)
 *   4. Persists the classification to sdr_reply_labels
 *   5. Routes: escalations are flagged for founder review; others continue
 *
 * Always returns 200 so SendGrid does not retry (errors are logged, not retried).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildDb } from "@/lib/db";
import { classifyReplyIntent } from "@/lib/sdr/reply-classifier";

export const runtime = "nodejs";

/** Extract a bare email address from "Display Name <email@example.com>" */
function extractEmail(header: string): string {
  const angleMatch = header.match(/<([^>@\s]+@[^>@\s]+)>/);
  if (angleMatch) return angleMatch[1].toLowerCase().trim();
  const bareMatch = header.match(/([^\s<>"',;]+@[^\s<>"',;]+)/);
  return bareMatch ? bareMatch[1].toLowerCase().trim() : header.toLowerCase().trim();
}

/** Strip HTML tags and collapse whitespace for plain-text extraction */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface ProspectRow {
  id: string;
  org_id: string;
  full_name: string;
  title: string | null;
  company: string;
  email: string | null;
  campaign_id: string;
}

interface TouchRow {
  id: string;
  touch_number: number;
  subject: string;
  body: string;
  sequence_id: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error(
      JSON.stringify({ event: "sdr.inbound_reply.parse_error", error: String(err) }),
    );
    // Return 200 to prevent SendGrid from retrying a malformed payload
    return NextResponse.json({ ok: true });
  }

  const from = (formData.get("from") as string | null) ?? "";
  const subject = (formData.get("subject") as string | null) ?? "";
  const plainText = (formData.get("text") as string | null) ?? "";
  const htmlBody = (formData.get("html") as string | null) ?? "";

  const rawReply = plainText.trim()
    ? plainText.trim()
    : stripHtml(htmlBody).trim();

  if (!from || !rawReply) {
    console.warn(
      JSON.stringify({
        event: "sdr.inbound_reply.missing_fields",
        has_from: Boolean(from),
        has_body: Boolean(rawReply),
      }),
    );
    return NextResponse.json({ ok: true });
  }

  const fromEmail = extractEmail(from);

  const db = buildDb();

  // Look up the prospect by sender email
  const prospectRows = await db.query<ProspectRow>(
    `SELECT id, org_id, full_name, title, company, email, campaign_id
       FROM sdr_prospects
      WHERE lower(email) = $1
      LIMIT 1`,
    fromEmail,
  );

  const prospect = prospectRows[0];
  if (!prospect) {
    console.log(
      JSON.stringify({
        event: "sdr.inbound_reply.prospect_not_found",
        from_email: fromEmail,
      }),
    );
    return NextResponse.json({ ok: true });
  }

  // Find the most recent sent touch for this prospect (via sequence join)
  const touchRows = await db.query<TouchRow>(
    `SELECT t.id, t.touch_number, t.subject, t.body, t.sequence_id
       FROM sdr_sequence_touches t
       JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
      WHERE seq.prospect_id = $1
        AND seq.org_id = $2
        AND t.status = 'sent'
      ORDER BY t.sent_at DESC
      LIMIT 1`,
    prospect.id,
    prospect.org_id,
  );

  const touch = touchRows[0];
  if (!touch) {
    console.log(
      JSON.stringify({
        event: "sdr.inbound_reply.no_sent_touch",
        prospect_id: prospect.id,
        org_id: prospect.org_id,
      }),
    );
    return NextResponse.json({ ok: true });
  }

  // Run the intent classifier
  let classification;
  try {
    classification = await classifyReplyIntent({
      rawReply,
      prospectName: prospect.full_name,
      prospectTitle: prospect.title,
      company: prospect.company,
      originalSubject: touch.subject,
      originalBody: touch.body,
      touchNumber: touch.touch_number,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "sdr.inbound_reply.classification_error",
        prospect_id: prospect.id,
        org_id: prospect.org_id,
        error: String(err),
      }),
    );
    // Fallback: store as "other" and escalate for manual review
    classification = {
      label: "other" as const,
      confidence: 0,
      reasoning: "Automatic classification failed — manual review required",
      shouldEscalate: true,
      escalationReason: "Classification error — requires founder review",
      draftFollowUp: null,
    };
  }

  const escalationStatus = classification.shouldEscalate ? "pending" : "none";
  const labelId = crypto.randomUUID();

  // Upsert the reply label record (idempotent on touch_id + org_id)
  await db.execute(
    `INSERT INTO sdr_reply_labels (
        id, org_id, touch_id, prospect_id,
        raw_reply,
        classifier_label, classifier_confidence, classifier_reasoning,
        effective_label,
        escalation_status,
        draft_follow_up,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5,
        $6, $7, $8,
        $9,
        $10,
        $11,
        NOW(), NOW()
      )
      ON CONFLICT (touch_id, org_id) DO UPDATE
        SET raw_reply             = EXCLUDED.raw_reply,
            classifier_label      = EXCLUDED.classifier_label,
            classifier_confidence = EXCLUDED.classifier_confidence,
            classifier_reasoning  = EXCLUDED.classifier_reasoning,
            effective_label       = EXCLUDED.effective_label,
            escalation_status     = EXCLUDED.escalation_status,
            draft_follow_up       = EXCLUDED.draft_follow_up,
            updated_at            = NOW()`,
    labelId,
    prospect.org_id,
    touch.id,
    prospect.id,
    rawReply,
    classification.label,
    classification.confidence,
    classification.reasoning,
    classification.label,
    escalationStatus,
    classification.draftFollowUp,
  );

  // Stamp the sequence touch with the effective reply label
  await db.execute(
    `UPDATE sdr_sequence_touches
        SET reply_label = $2, updated_at = NOW()
      WHERE id = $1`,
    touch.id,
    classification.label,
  );

  // Suppress further outreach for definitive rejections
  if (classification.label === "not_interested") {
    await db.execute(
      `INSERT INTO sdr_suppressions (id, org_id, email, reason, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (org_id, email) DO NOTHING`,
      crypto.randomUUID(),
      prospect.org_id,
      fromEmail,
      "not_interested_reply",
    );
  }

  console.log(
    JSON.stringify({
      event: "sdr.inbound_reply.classified",
      org_id: prospect.org_id,
      label_id: labelId,
      touch_id: touch.id,
      prospect_id: prospect.id,
      label: classification.label,
      confidence: classification.confidence,
      escalated: classification.shouldEscalate,
      subject,
    }),
  );

  if (classification.shouldEscalate) {
    console.log(
      JSON.stringify({
        event: "sdr.inbound_reply.escalation_required",
        org_id: prospect.org_id,
        label_id: labelId,
        touch_id: touch.id,
        prospect_id: prospect.id,
        prospect_name: prospect.full_name,
        company: prospect.company,
        label: classification.label,
        escalation_reason: classification.escalationReason,
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
