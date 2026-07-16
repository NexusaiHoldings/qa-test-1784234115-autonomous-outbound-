import type { JSX } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { VERTICAL_TEMPLATES } from "@/lib/sdr/vertical-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Types ────────────────────────────────────────────────────────────────────

interface CampaignRow {
  id: string;
  org_id: string;
  name: string;
  vertical: string;
  tone: string;
  template_key: string;
  status: string;
}

interface TouchStat {
  touch_number: number;
  status: string;
  count: number;
}

interface SampleTouch {
  touch_number: number;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
}

type StatusKey = "queued" | "sent" | "bounced" | "replied";

// ── Auth helper ──────────────────────────────────────────────────────────────

async function resolveOrgId(): Promise<string | null> {
  const token = cookies().get("session_token")?.value;
  if (!token) return null;
  try {
    const result = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    if (
      result.status !== 200 ||
      typeof result.body !== "object" ||
      !result.body
    ) {
      return null;
    }
    const body = result.body as { user_id?: string };
    return body.user_id ?? null;
  } catch {
    return null;
  }
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function loadPageData(
  campaignId: string,
  orgId: string,
): Promise<{
  campaign: CampaignRow;
  stats: TouchStat[];
  samples: SampleTouch[];
} | null> {
  const db = buildDb();

  const campaigns = await db.query<CampaignRow>(
    `SELECT id, org_id, name, vertical, tone, template_key, status
     FROM sdr_campaigns
     WHERE id = $1 AND org_id = $2`,
    campaignId,
    orgId,
  );
  const campaign = campaigns[0];
  if (!campaign) return null;

  const stats = await db.query<TouchStat>(
    `SELECT t.touch_number, t.status, COUNT(*) AS count
     FROM sdr_sequence_touches t
     JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
     WHERE seq.campaign_id = $1 AND t.org_id = $2
     GROUP BY t.touch_number, t.status
     ORDER BY t.touch_number, t.status`,
    campaignId,
    orgId,
  );

  const samples = await db.query<SampleTouch>(
    `SELECT DISTINCT ON (t.touch_number)
            t.touch_number, t.subject, t.body, t.status,
            t.scheduled_at::text AS scheduled_at,
            t.sent_at::text AS sent_at
     FROM sdr_sequence_touches t
     JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
     WHERE seq.campaign_id = $1 AND t.org_id = $2
     ORDER BY t.touch_number,
       CASE t.status WHEN 'sent' THEN 1 WHEN 'queued' THEN 2
                     WHEN 'bounced' THEN 3 ELSE 4 END,
       t.scheduled_at ASC`,
    campaignId,
    orgId,
  );

  return { campaign, stats: stats.map((r) => ({ ...r, count: Number(r.count) })), samples };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<StatusKey, { bg: string; color: string }> = {
  queued:  { bg: "#f3f4f6", color: "#374151" },
  sent:    { bg: "#dcfce7", color: "#166534" },
  bounced: { bg: "#fee2e2", color: "#991b1b" },
  replied: { bg: "#dbeafe", color: "#1e40af" },
};

function statusStyle(status: string): { bg: string; color: string } {
  return STATUS_COLORS[status as StatusKey] ?? { bg: "#f3f4f6", color: "#374151" };
}

const TOUCH_LABELS: Record<number, { label: string; day: string; benefit: string }> = {
  1: {
    label: "Touch 1 — Initial Outreach",
    day: "Day 0",
    benefit: "Leads with the trigger event to establish timely relevance and deliver the core value proposition.",
  },
  2: {
    label: "Touch 2 — Follow-Up",
    day: "Day 3",
    benefit: "Pivots to a complementary pain-point angle or a brief proof point — keeps the conversation alive without repetition.",
  },
  3: {
    label: "Touch 3 — Final Nudge",
    day: "Day 7",
    benefit: "Polite last attempt that makes replying as frictionless as possible — one word suffices.",
  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default async function SequencePage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const orgId = await resolveOrgId();
  if (!orgId) {
    return (
      <main>
        <h1>Sequence Review</h1>
        <p className="muted">Please sign in to view this page.</p>
      </main>
    );
  }

  const data = await loadPageData(params.id, orgId);
  if (!data) notFound();

  const { campaign, stats, samples } = data;
  const verticalLabel =
    VERTICAL_TEMPLATES[campaign.vertical as keyof typeof VERTICAL_TEMPLATES]
      ?.label ?? campaign.vertical;

  // Build a stats lookup: stats[touchNum][status] = count
  const statsMap: Record<number, Partial<Record<StatusKey, number>>> = {};
  for (const row of stats) {
    if (!statsMap[row.touch_number]) statsMap[row.touch_number] = {};
    statsMap[row.touch_number][row.status as StatusKey] = row.count;
  }

  const sampleMap: Record<number, SampleTouch> = {};
  for (const row of samples) {
    sampleMap[row.touch_number] = row;
  }

  const hasSequences = stats.length > 0;
  const allStatuses: StatusKey[] = ["queued", "sent", "bounced", "replied"];

  return (
    <main>
      {/* ── Page header ── */}
      <style>{`
        .touch-card {
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .touch-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.09);
        }
        .status-pill {
          display: inline-block;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
          margin-right: 6px;
        }
        .email-preview {
          background: #fafafa;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 1rem 1.25rem;
          font-size: 0.875rem;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 260px;
          overflow-y: auto;
        }
        .timeline-rail {
          display: flex;
          align-items: flex-start;
          gap: 0;
          margin-bottom: 2.5rem;
          position: relative;
        }
        .timeline-rail::before {
          content: "";
          position: absolute;
          top: 18px;
          left: 18px;
          right: 18px;
          height: 2px;
          background: #e5e7eb;
          z-index: 0;
        }
        .timeline-node {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
          z-index: 1;
        }
        .timeline-dot {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #2563eb;
          color: #fff;
          font-weight: 700;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.35rem;
          border: 3px solid #fff;
          box-shadow: 0 0 0 2px #2563eb;
        }
        .timeline-day {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "0.5rem" }}>
        <div>
          <h1>{campaign.name} — Sequence</h1>
          <p className="muted">
            {verticalLabel} · {campaign.tone} tone ·{" "}
            <span style={{ textTransform: "capitalize" }}>{campaign.status}</span>
          </p>
        </div>
        <Link href="/campaigns" className="btn secondary">
          ← Campaigns
        </Link>
      </div>

      {/* ── Timeline rail ── */}
      <div className="timeline-rail">
        {[1, 2, 3].map((num) => (
          <div key={num} className="timeline-node">
            <div className="timeline-dot">{num}</div>
            <span className="timeline-day">{TOUCH_LABELS[num].day}</span>
          </div>
        ))}
      </div>

      {/* ── Touch cards ── */}
      {hasSequences ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {[1, 2, 3].map((touchNum) => {
            const meta = TOUCH_LABELS[touchNum];
            const touchStats = statsMap[touchNum] ?? {};
            const sample = sampleMap[touchNum];
            return (
              <div
                key={touchNum}
                className="card touch-card"
                style={{ padding: "1.5rem" }}
              >
                {/* Card header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 700 }}>{meta.label}</h3>
                    <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>{meta.benefit}</p>
                  </div>
                  <div>
                    {allStatuses.map((st) => {
                      const cnt = touchStats[st];
                      if (!cnt) return null;
                      const style = statusStyle(st);
                      return (
                        <span
                          key={st}
                          className="status-pill"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {st} {cnt}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Email preview */}
                {sample ? (
                  <>
                    <p style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.4rem" }}>
                      Subject: {sample.subject}
                    </p>
                    <div className="email-preview">{sample.body}</div>
                    <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
                      Scheduled {new Date(sample.scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {sample.sent_at ? ` · Sent ${new Date(sample.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                    </p>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: "0.875rem" }}>No touches queued yet for this step.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty" style={{ marginTop: "2rem" }}>
          <h2 style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            No sequences queued yet
          </h2>
          <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1rem" }}>
            Activate this campaign to start sourcing prospects. Once verified
            emails are available, the daily cron will compose and queue your
            3-touch sequences — each email grounded in the prospect&apos;s top
            trigger event.
          </p>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            The sequence dispatcher runs at{" "}
            <code>/api/cron/sequence-dispatch</code> and respects your
            per-tenant daily send cap.
          </p>
        </div>
      )}
    </main>
  );
}
