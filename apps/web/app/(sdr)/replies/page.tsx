import type { JSX } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplyRow {
  id: string;
  org_id: string;
  touch_id: string;
  prospect_id: string;
  raw_reply: string;
  classifier_label: string;
  classifier_confidence: string;
  classifier_reasoning: string | null;
  effective_label: string;
  founder_override_label: string | null;
  escalation_status: string;
  draft_follow_up: string | null;
  approved_at: string | null;
  created_at: string;
  prospect_name: string;
  prospect_email: string | null;
  prospect_company: string;
  prospect_title: string | null;
  touch_number: number;
  touch_subject: string;
  campaign_name: string | null;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function resolveOrgId(): Promise<string | null> {
  const token = cookies().get("session_token")?.value;
  if (!token) return null;
  try {
    const result = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    if (result.status !== 200 || typeof result.body !== "object" || !result.body) {
      return null;
    }
    const body = result.body as { user_id?: string };
    return body.user_id ?? null;
  } catch {
    return null;
  }
}

// ─── DB queries ───────────────────────────────────────────────────────────────

async function listReplies(orgId: string): Promise<ReplyRow[]> {
  const db = buildDb();
  return db.query<ReplyRow>(
    `SELECT
       rl.id, rl.org_id, rl.touch_id, rl.prospect_id,
       rl.raw_reply,
       rl.classifier_label,
       rl.classifier_confidence::text,
       rl.classifier_reasoning,
       rl.effective_label,
       rl.founder_override_label,
       rl.escalation_status,
       rl.draft_follow_up,
       rl.approved_at::text,
       rl.created_at::text,
       p.full_name  AS prospect_name,
       p.email      AS prospect_email,
       p.company    AS prospect_company,
       p.title      AS prospect_title,
       t.touch_number,
       t.subject    AS touch_subject,
       c.name       AS campaign_name
     FROM sdr_reply_labels rl
     JOIN sdr_prospects p        ON p.id  = rl.prospect_id
     JOIN sdr_sequence_touches t ON t.id  = rl.touch_id
     JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
     JOIN sdr_campaigns c        ON c.id  = seq.campaign_id
     WHERE rl.org_id = $1
     ORDER BY rl.created_at DESC
     LIMIT 100`,
    orgId,
  );
}

// ─── Server actions ───────────────────────────────────────────────────────────

async function approveFollowUp(formData: FormData): Promise<void> {
  "use server";
  const labelId = formData.get("label_id") as string | null;
  const orgId = formData.get("org_id") as string | null;
  if (!labelId || !orgId) return;
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_reply_labels
        SET approved_at  = NOW(),
            updated_at   = NOW()
      WHERE id = $1 AND org_id = $2`,
    labelId,
    orgId,
  );
  revalidatePath("/replies");
}

async function saveEditedDraft(formData: FormData): Promise<void> {
  "use server";
  const labelId = formData.get("label_id") as string | null;
  const orgId = formData.get("org_id") as string | null;
  const newDraft = formData.get("draft") as string | null;
  if (!labelId || !orgId || !newDraft) return;
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_reply_labels
        SET draft_follow_up = $3,
            approved_at     = NOW(),
            updated_at      = NOW()
      WHERE id = $1 AND org_id = $2`,
    labelId,
    orgId,
    newDraft.trim(),
  );
  revalidatePath("/replies");
}

async function markEscalationReviewed(formData: FormData): Promise<void> {
  "use server";
  const labelId = formData.get("label_id") as string | null;
  const orgId = formData.get("org_id") as string | null;
  if (!labelId || !orgId) return;
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_reply_labels
        SET escalation_status     = 'reviewed',
            escalation_notified_at = NOW(),
            updated_at             = NOW()
      WHERE id = $1 AND org_id = $2`,
    labelId,
    orgId,
  );
  revalidatePath("/replies");
}

// ─── Intent pill colors ───────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  interested:     "#16a34a",
  objection:      "#d97706",
  not_interested: "#6b7280",
  out_of_office:  "#0369a1",
  other:          "#7c3aed",
};

const INTENT_LABELS: Record<string, string> = {
  interested:     "Interested",
  objection:      "Objection",
  not_interested: "Not Interested",
  out_of_office:  "Out of Office",
  other:          "Other",
};

const ESCALATION_COLORS: Record<string, string> = {
  pending:  "#dc2626",
  reviewed: "#16a34a",
  none:     "#6b7280",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function IntentPill({ label }: { label: string }): JSX.Element {
  const color = INTENT_COLORS[label] ?? "#6b7280";
  const text = INTENT_LABELS[label] ?? label;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        textTransform: "capitalize" as const,
        whiteSpace: "nowrap" as const,
      }}
    >
      {text}
    </span>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }): JSX.Element {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80 ? "#16a34a" : pct >= 55 ? "#d97706" : "#dc2626";
  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          width: "100%",
          background: "#e5e7eb",
          height: 4,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 2,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: "#6b7280" }}>{pct}% confidence</span>
    </div>
  );
}

function EscalationBadge({ status }: { status: string }): JSX.Element | null {
  if (status === "none") return null;
  const color = ESCALATION_COLORS[status] ?? "#6b7280";
  const label =
    status === "pending"
      ? "Needs Review"
      : status === "reviewed"
        ? "Reviewed"
        : status;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 700,
        background: `${color}15`,
        color,
        border: `1px solid ${color}40`,
        marginLeft: 6,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  );
}

function ThreadCard({
  reply,
  isSelected,
}: {
  reply: ReplyRow;
  isSelected: boolean;
}): JSX.Element {
  const confidence = parseFloat(reply.classifier_confidence) || 0;
  const date = new Date(reply.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/replies?id=${reply.id}`}
      style={{ textDecoration: "none", display: "block", marginBottom: "0.75rem" }}
    >
      <div
        className="card"
        style={{
          cursor: "pointer",
          borderColor: isSelected ? "#2563eb" : undefined,
          background: isSelected ? "#eff6ff" : undefined,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "0.5rem",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {reply.prospect_name}
              <EscalationBadge status={reply.escalation_status} />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {reply.prospect_company}
            </div>
          </div>
          <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
            {date}
          </span>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <IntentPill label={reply.effective_label} />
        </div>
        <ConfidenceBar confidence={confidence} />
        <p
          className="muted"
          style={{
            fontSize: 12,
            marginTop: "0.4rem",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as const,
            lineHeight: 1.4,
          }}
        >
          {reply.raw_reply.slice(0, 120)}
          {reply.raw_reply.length > 120 ? "…" : ""}
        </p>
      </div>
    </Link>
  );
}

function ReplyDetail({
  reply,
  orgId,
}: {
  reply: ReplyRow;
  orgId: string;
}): JSX.Element {
  const confidence = parseFloat(reply.classifier_confidence) || 0;
  const isEscalated =
    reply.escalation_status === "pending" || reply.escalation_status === "reviewed";
  const isApproved = Boolean(reply.approved_at);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{reply.prospect_name}</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {reply.prospect_title ? `${reply.prospect_title} · ` : ""}
            {reply.prospect_company}
            {reply.prospect_email ? ` · ${reply.prospect_email}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <IntentPill label={reply.effective_label} />
          {isEscalated && <EscalationBadge status={reply.escalation_status} />}
        </div>
      </div>

      {/* Classification meta */}
      <div
        className="card"
        style={{ marginBottom: "1rem", fontSize: 13 }}
      >
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            flexWrap: "wrap",
            marginBottom: "0.5rem",
          }}
        >
          <div>
            <span className="muted">Campaign: </span>
            <strong>{reply.campaign_name ?? "—"}</strong>
          </div>
          <div>
            <span className="muted">Touch: </span>
            <strong>{reply.touch_number} of 3</strong>
          </div>
          <div>
            <span className="muted">Confidence: </span>
            <strong>{Math.round(confidence * 100)}%</strong>
          </div>
        </div>
        {reply.classifier_reasoning && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            <strong>AI Reasoning:</strong> {reply.classifier_reasoning}
          </p>
        )}
        {reply.founder_override_label && (
          <p style={{ margin: "0.5rem 0 0", fontSize: 12, color: "#7c3aed" }}>
            Founder override: {INTENT_LABELS[reply.founder_override_label] ?? reply.founder_override_label}
          </p>
        )}
      </div>

      {/* Original email */}
      <div
        className="card"
        style={{ marginBottom: "1rem", fontSize: 13 }}
      >
        <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
          Original Email — Touch {reply.touch_number}
        </p>
        <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>{reply.touch_subject}</p>
      </div>

      {/* Prospect reply */}
      <div
        className="card"
        style={{ marginBottom: "1rem", fontSize: 13, borderLeft: "3px solid #2563eb" }}
      >
        <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
          Prospect Reply
        </p>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" as const, lineHeight: 1.6 }}>
          {reply.raw_reply}
        </p>
      </div>

      {/* Escalation panel */}
      {isEscalated && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            borderLeft: reply.escalation_status === "pending" ? "3px solid #dc2626" : "3px solid #16a34a",
          }}
        >
          <p
            style={{
              margin: "0 0 0.5rem",
              fontWeight: 600,
              color: reply.escalation_status === "pending" ? "#dc2626" : "#16a34a",
              fontSize: 14,
            }}
          >
            {reply.escalation_status === "pending"
              ? "Escalated — Founder Review Required"
              : "Escalation Reviewed"}
          </p>
          <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: 13 }}>
            This reply was automatically escalated because it contains a{" "}
            {reply.effective_label === "interested"
              ? "genuine buying signal"
              : "sensitive objection or edge case"}{" "}
            requiring your personal attention.
          </p>
          {reply.escalation_status === "pending" && (
            <form action={markEscalationReviewed}>
              <input type="hidden" name="label_id" value={reply.id} />
              <input type="hidden" name="org_id" value={orgId} />
              <button type="submit" className="btn secondary">
                Mark as Reviewed
              </button>
            </form>
          )}
        </div>
      )}

      {/* Draft follow-up panel (non-escalated only) */}
      {!isEscalated && reply.draft_follow_up && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
            AI-Drafted Follow-Up
          </p>
          {isApproved ? (
            <div>
              <p style={{ margin: "0 0 0.5rem", fontSize: 13, whiteSpace: "pre-wrap" as const, lineHeight: 1.6 }}>
                {reply.draft_follow_up}
              </p>
              <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
                ✓ Approved
              </span>
            </div>
          ) : (
            <div>
              <form action={approveFollowUp} style={{ marginBottom: "0.75rem" }}>
                <input type="hidden" name="label_id" value={reply.id} />
                <input type="hidden" name="org_id" value={orgId} />
                <p style={{ margin: "0 0 0.5rem", fontSize: 13, whiteSpace: "pre-wrap" as const, lineHeight: 1.6 }}>
                  {reply.draft_follow_up}
                </p>
                <button type="submit" className="btn">
                  Approve &amp; Send
                </button>
              </form>
              <details>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#6b7280",
                    userSelect: "none" as const,
                    marginBottom: "0.5rem",
                  }}
                >
                  Edit before sending
                </summary>
                <form action={saveEditedDraft} style={{ marginTop: "0.5rem" }}>
                  <input type="hidden" name="label_id" value={reply.id} />
                  <input type="hidden" name="org_id" value={orgId} />
                  <textarea
                    name="draft"
                    defaultValue={reply.draft_follow_up}
                    rows={6}
                    style={{ width: "100%", fontSize: 13, lineHeight: 1.6 }}
                  />
                  <button type="submit" className="btn secondary" style={{ marginTop: "0.5rem" }}>
                    Save &amp; Send Edited Version
                  </button>
                </form>
              </details>
            </div>
          )}
        </div>
      )}

      {/* No draft for auto-routed replies with no follow-up */}
      {!isEscalated && !reply.draft_follow_up && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            No follow-up drafted — sequence concluded or reply type does not require one.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RepliesPage({
  searchParams,
}: {
  searchParams: { id?: string };
}): Promise<JSX.Element> {
  const orgId = await resolveOrgId();

  if (!orgId) {
    return (
      <main>
        <h1>Reply Inbox</h1>
        <p>Sign in to view your inbound replies.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const replies = await listReplies(orgId);

  if (replies.length === 0) {
    return (
      <main>
        <h1>Reply Inbox</h1>
        <p>
          AI-classified inbound replies — escalations require your review, the rest continue
          automatically.
        </p>
        <div className="empty" style={{ marginTop: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📬</div>
          <h2 style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            No replies yet — your first sequence is warming up
          </h2>
          <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem" }}>
            Replies will appear here automatically once prospects respond to your
            outbound sequence. The AI classifier labels each reply and routes it:
            buying conversations escalate to you instantly, everything else
            continues autonomously.
          </p>
          <Link href="/campaigns" className="btn secondary">
            View Campaigns
          </Link>
        </div>
      </main>
    );
  }

  const selectedId = searchParams.id;
  const selectedReply = selectedId
    ? replies.find((r) => r.id === selectedId) ?? replies[0]
    : replies[0];

  const pendingEscalations = replies.filter(
    (r) => r.escalation_status === "pending",
  ).length;

  return (
    <main>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "0.25rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Reply Inbox</h1>
        {pendingEscalations > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              background: "#fef2f2",
              color: "#dc2626",
              border: "1px solid #fca5a5",
            }}
          >
            {pendingEscalations} escalation{pendingEscalations !== 1 ? "s" : ""} need
            {pendingEscalations === 1 ? "s" : ""} review
          </span>
        )}
      </div>
      <p>
        AI-classified inbound replies. Buying conversations and sensitive objections
        are escalated to you; everything else continues autonomously.
      </p>

      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          alignItems: "flex-start",
          marginTop: "1.5rem",
        }}
      >
        {/* Left pane — thread list */}
        <aside
          style={{
            width: "320px",
            flexShrink: 0,
            maxHeight: "80vh",
            overflowY: "auto",
          }}
        >
          <p className="muted" style={{ fontSize: 12, marginBottom: "0.75rem" }}>
            {replies.length} repl{replies.length !== 1 ? "ies" : "y"}
          </p>
          {replies.map((reply) => (
            <ThreadCard
              key={reply.id}
              reply={reply}
              isSelected={reply.id === selectedReply?.id}
            />
          ))}
        </aside>

        {/* Right pane — reply detail */}
        <section style={{ flex: 1, minWidth: 0 }}>
          {selectedReply ? (
            <ReplyDetail reply={selectedReply} orgId={orgId} />
          ) : (
            <div className="empty">
              <p className="muted">Select a reply from the list to view details.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
