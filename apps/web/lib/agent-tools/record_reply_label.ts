/**
 * Agent tool handler: record_reply_label
 *
 * Confirm-gated mutation. Persists the reply classification plus any founder
 * override into sdr_reply_labels, accumulating the proprietary training corpus.
 * Called after classification and after founder review.
 *
 * Autonomy = autonomous — mutations route through the cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

interface Args {
  touch_id: string;
  org_id: string;
  prospect_id: string;
  raw_reply: string;
  classifier_label: string;
  classifier_confidence: number;
  classifier_reasoning?: string;
  founder_override_label?: string;
  founder_override_reason?: string;
}

interface ExistingLabelRow {
  id: string;
  classifier_label: string;
  founder_override_label: string | null;
}

const VALID_LABELS = [
  "interested",
  "not_interested",
  "auto_reply",
  "objection",
  "referral",
  "meeting_booked",
  "unsubscribe",
  "question",
  "other",
] as const;

type ReplyLabel = (typeof VALID_LABELS)[number];

function isValidLabel(label: string): label is ReplyLabel {
  return (VALID_LABELS as readonly string[]).includes(label);
}

export async function handleRecordReplyLabel(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const {
    touch_id,
    org_id,
    prospect_id,
    raw_reply,
    classifier_label,
    classifier_confidence,
    classifier_reasoning,
    founder_override_label,
    founder_override_reason,
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
  if (!raw_reply || typeof raw_reply !== "string") {
    return { status: 400, body: "raw_reply is required" };
  }
  if (!classifier_label || typeof classifier_label !== "string") {
    return { status: 400, body: "classifier_label is required" };
  }
  if (!isValidLabel(classifier_label)) {
    return {
      status: 400,
      body: `classifier_label must be one of: ${VALID_LABELS.join(", ")}`,
    };
  }
  if (
    classifier_confidence === undefined ||
    typeof classifier_confidence !== "number" ||
    classifier_confidence < 0 ||
    classifier_confidence > 1
  ) {
    return { status: 400, body: "classifier_confidence must be a number between 0 and 1" };
  }
  if (founder_override_label !== undefined && !isValidLabel(founder_override_label)) {
    return {
      status: 400,
      body: `founder_override_label must be one of: ${VALID_LABELS.join(", ")}`,
    };
  }

  // Verify the touch belongs to this org and prospect
  const touchRows = await ctx.db.query<{ id: string; status: string }>(
    `SELECT id, status
       FROM sdr_sequence_touches
      WHERE id = $1 AND org_id = $2 AND prospect_id = $3`,
    touch_id,
    org_id,
    prospect_id
  );
  const touch = touchRows[0];
  if (!touch) {
    return { status: 404, body: "Sequence touch not found for this org and prospect" };
  }

  // Verify the prospect belongs to this org
  const prospectRows = await ctx.db.query<{ id: string; email: string | null }>(
    `SELECT id, email
       FROM sdr_prospects
      WHERE id = $1 AND org_id = $2`,
    prospect_id,
    org_id
  );
  const prospect = prospectRows[0];
  if (!prospect) {
    return { status: 404, body: "Prospect not found" };
  }

  // Determine the effective label (founder override takes precedence over classifier)
  const effectiveLabel = founder_override_label ?? classifier_label;

  // Check for an existing label record for this touch
  const existingRows = await ctx.db.query<ExistingLabelRow>(
    `SELECT id, classifier_label, founder_override_label
       FROM sdr_reply_labels
      WHERE touch_id = $1 AND org_id = $2
      LIMIT 1`,
    touch_id,
    org_id
  );
  const existing = existingRows[0];

  let labelId: string;

  if (existing) {
    // Update the existing record (e.g., founder is overriding a prior classification)
    labelId = existing.id;
    await ctx.db.execute(
      `UPDATE sdr_reply_labels
          SET classifier_label = $3,
              classifier_confidence = $4,
              classifier_reasoning = $5,
              founder_override_label = $6,
              founder_override_reason = $7,
              effective_label = $8,
              updated_at = NOW()
        WHERE id = $1 AND org_id = $2`,
      labelId,
      org_id,
      classifier_label,
      classifier_confidence,
      classifier_reasoning ?? null,
      founder_override_label ?? null,
      founder_override_reason ?? null,
      effectiveLabel
    );
  } else {
    // Insert a new label record
    labelId = crypto.randomUUID();
    await ctx.db.execute(
      `INSERT INTO sdr_reply_labels (
          id, org_id, touch_id, prospect_id,
          raw_reply,
          classifier_label, classifier_confidence, classifier_reasoning,
          founder_override_label, founder_override_reason,
          effective_label,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5,
          $6, $7, $8,
          $9, $10,
          $11,
          NOW(), NOW()
        )`,
      labelId,
      org_id,
      touch_id,
      prospect_id,
      raw_reply,
      classifier_label,
      classifier_confidence,
      classifier_reasoning ?? null,
      founder_override_label ?? null,
      founder_override_reason ?? null,
      effectiveLabel
    );
  }

  // Update the sequence touch reply status to reflect the classified label
  await ctx.db.execute(
    `UPDATE sdr_sequence_touches
        SET reply_label = $2,
            updated_at = NOW()
      WHERE id = $1`,
    touch_id,
    effectiveLabel
  );

  const wasOverridden = founder_override_label !== undefined && founder_override_label !== null;

  return {
    status: 200,
    body: {
      label_id: labelId,
      touch_id,
      prospect_id,
      org_id,
      classifier_label,
      classifier_confidence,
      effective_label: effectiveLabel,
      was_founder_override: wasOverridden,
      ...(wasOverridden && {
        founder_override_label,
        founder_override_reason: founder_override_reason ?? null,
      }),
      message: wasOverridden
        ? `Reply labelled as "${effectiveLabel}" (founder override from "${classifier_label}")`
        : `Reply labelled as "${effectiveLabel}" by classifier (confidence: ${(classifier_confidence * 100).toFixed(1)}%)`,
    },
  };
}
