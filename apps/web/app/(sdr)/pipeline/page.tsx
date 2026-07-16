import type { JSX, CSSProperties } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { getPipelineMetrics } from "@/lib/sdr/pipeline-metrics";
import type { PipelineMetrics, FunnelStages, ActivityItem } from "@/lib/sdr/pipeline-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Auth ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function conversionRate(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ZeroState(): JSX.Element {
  return (
    <div
      className="empty"
      style={{
        marginTop: "3rem",
        textAlign: "center",
        padding: "3rem 2rem",
      }}
    >
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🚀</div>
      <h2 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "1.25rem" }}>
        Your agent is sourcing prospects
      </h2>
      <p className="muted" style={{ maxWidth: 480, margin: "0 auto 0.75rem" }}>
        First sends go out today. The funnel will populate as prospects are contacted
        and replies come in — your first meeting is usually within 3–7 days.
      </p>
      <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem", fontSize: 13 }}>
        The category failure is volume without qualified meetings. Your agent is
        trigger-grounded from the start — every email is anchored to a real buying
        signal, not a spray-and-pray blast.
      </p>
      <Link href="/campaigns" className="btn secondary">
        Review campaigns
      </Link>
    </div>
  );
}

function EarlySendState(): JSX.Element {
  return (
    <div
      className="empty"
      style={{
        marginTop: "3rem",
        textAlign: "center",
        padding: "3rem 2rem",
      }}
    >
      <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📧</div>
      <h2 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "1.25rem" }}>
        Sequences are live — replies incoming
      </h2>
      <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem" }}>
        Prospects have been sourced and emails are being sent. Your pipeline metrics
        will appear here once replies and meetings start flowing.
      </p>
      <Link href="/prospects" className="btn secondary">
        View prospects
      </Link>
    </div>
  );
}

const ACCENT = "#2563eb";

function HeroSection({ metrics }: { metrics: PipelineMetrics }): JSX.Element {
  const { meetingsBookedThisMonth, meetingsBookedTotal, timeToFirstMeetingDays } = metrics;

  const heroCardStyle: CSSProperties = {
    flex: "1 1 280px",
    minWidth: 0,
    padding: "2rem 2rem 1.75rem",
    borderRadius: 12,
    border: `2px solid ${ACCENT}20`,
    background: "linear-gradient(135deg, #eff6ff 0%, #fff 60%)",
    boxShadow: "0 2px 12px rgba(37,99,235,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  };

  const secondCardStyle: CSSProperties = {
    flex: "1 1 220px",
    minWidth: 0,
    padding: "1.5rem 2rem",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    justifyContent: "center",
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
        marginBottom: "2.5rem",
      }}
    >
      {/* Primary hero card */}
      <div style={heroCardStyle}>
        <div
          className="hero-stat-number"
          style={{
            fontSize: "4.5rem",
            fontWeight: 800,
            lineHeight: 1,
            color: ACCENT,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {meetingsBookedThisMonth}
        </div>
        <div
          style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginTop: "0.25rem" }}
        >
          meetings booked this month
        </div>
        {meetingsBookedTotal > meetingsBookedThisMonth && (
          <div className="muted" style={{ fontSize: 12, marginTop: "0.25rem" }}>
            {meetingsBookedTotal} all-time
          </div>
        )}
      </div>

      {/* Secondary stat */}
      <div style={secondCardStyle}>
        <div
          style={{
            fontSize: "2.25rem",
            fontWeight: 700,
            lineHeight: 1,
            color: "#111827",
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {timeToFirstMeetingDays !== null ? `${timeToFirstMeetingDays}d` : "—"}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#6b7280", marginTop: "0.25rem" }}>
          time to first meeting
        </div>
        {timeToFirstMeetingDays !== null && (
          <div className="muted" style={{ fontSize: 11, marginTop: "0.25rem" }}>
            from first send to first booking
          </div>
        )}
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<keyof FunnelStages, string> = {
  prospectsSourced: "Sourced",
  emailsSent: "Sent",
  replies: "Replies",
  interested: "Interested",
  meetingsBooked: "Meetings",
};

const STAGE_COLORS: Record<keyof FunnelStages, string> = {
  prospectsSourced: "#6366f1",
  emailsSent: "#3b82f6",
  replies: "#0ea5e9",
  interested: "#10b981",
  meetingsBooked: ACCENT,
};

function FunnelStrip({ stages }: { stages: FunnelStages }): JSX.Element {
  const stageKeys: (keyof FunnelStages)[] = [
    "prospectsSourced",
    "emailsSent",
    "replies",
    "interested",
    "meetingsBooked",
  ];

  const stageValues: number[] = stageKeys.map((k) => stages[k]);

  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", color: "#374151" }}>
        Pipeline Funnel
      </h2>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          overflowX: "auto",
          paddingBottom: "0.25rem",
        }}
      >
        {stageKeys.map((key, idx) => {
          const value = stageValues[idx] ?? 0;
          const prevValue = idx > 0 ? (stageValues[idx - 1] ?? 0) : null;
          const rate = prevValue !== null ? conversionRate(value, prevValue) : null;
          const color = STAGE_COLORS[key];
          const isLast = idx === stageKeys.length - 1;

          return (
            <div
              key={key}
              style={{ display: "flex", alignItems: "center", flex: isLast ? "1 1 auto" : undefined }}
            >
              <div
                className="funnel-stage"
                style={{
                  padding: "1.25rem 1.5rem",
                  borderRadius: 10,
                  border: key === "meetingsBooked" ? `2px solid ${ACCENT}40` : "1px solid #e2e8f0",
                  background: key === "meetingsBooked" ? "#eff6ff" : "#fff",
                  boxShadow:
                    key === "meetingsBooked"
                      ? "0 4px 16px rgba(37,99,235,0.12)"
                      : "0 1px 4px rgba(0,0,0,0.05)",
                  minWidth: 110,
                  flex: 1,
                  animationDelay: `${idx * 0.1}s`,
                  opacity: 0,
                }}
              >
                <div
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: 800,
                    lineHeight: 1,
                    color,
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {value.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#6b7280",
                    marginTop: "0.35rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {STAGE_LABELS[key]}
                </div>
                {rate !== null && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#9ca3af",
                      marginTop: "0.25rem",
                    }}
                  >
                    {rate} of prev
                  </div>
                )}
              </div>

              {!isLast && (
                <div
                  style={{
                    padding: "0 0.4rem",
                    color: "#d1d5db",
                    fontSize: 18,
                    flexShrink: 0,
                    userSelect: "none",
                  }}
                >
                  →
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ACTIVITY_ICONS: Record<ActivityItem["type"], string> = {
  meeting_booked: "📅",
  reply_interested: "🟢",
  reply_received: "💬",
};

function ActivityFeed({ activity }: { activity: ActivityItem[] }): JSX.Element {
  if (activity.length === 0) {
    return (
      <section>
        <h2 style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", color: "#374151" }}>
          Recent Activity
        </h2>
        <div className="empty">
          <p className="muted" style={{ textAlign: "center" }}>
            Activity will appear here as your agent books meetings and receives replies.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", color: "#374151" }}>
        Recent Activity
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {activity.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.65rem 1rem",
              borderRadius: 8,
              border: "1px solid #f1f5f9",
              background: item.type === "meeting_booked" ? "#f0fdf4" : "#fafafa",
            }}
          >
            <span style={{ fontSize: 15, flexShrink: 0 }}>
              {ACTIVITY_ICONS[item.type]}
            </span>
            <span style={{ fontSize: 13, color: "#374151", flex: 1, minWidth: 0 }}>
              {item.description}
            </span>
            <span
              className="muted"
              style={{ fontSize: 11, flexShrink: 0, whiteSpace: "nowrap" as const }}
            >
              {relativeTime(item.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Animation CSS ─────────────────────────────────────────────────────────────

const ANIMATION_CSS = `
  @keyframes heroFadeUp {
    from { opacity: 0; transform: translateY(14px) scale(0.94); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  .hero-stat-number {
    animation: heroFadeUp 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  @keyframes stageReveal {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  .funnel-stage {
    animation: stageReveal 0.5s ease-out both;
  }
`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PipelinePage(): Promise<JSX.Element> {
  const orgId = await resolveOrgId();

  if (!orgId) {
    return (
      <main>
        <h1>Pipeline</h1>
        <p>Sign in to view your meeting pipeline.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const metrics = await getPipelineMetrics(orgId);
  const { hasAnyProspects, hasAnySends, funnelStages, recentActivity } = metrics;

  const showZeroState = !hasAnyProspects;
  const showEarlyState = hasAnyProspects && !hasAnySends;
  const showDashboard = hasAnyProspects && hasAnySends;

  return (
    <main>
      <style>{ANIMATION_CSS}</style>

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
        <h1 style={{ margin: 0 }}>Pipeline</h1>
        {metrics.meetingsBookedTotal > 0 && (
          <Link href="/meetings" className="btn secondary">
            View all meetings
          </Link>
        )}
      </div>

      <p>
        Meeting performance — the only metric that matters.{" "}
        <span className="muted">
          Conversion happens within 24 hours of the first call.
        </span>
      </p>

      {showZeroState && <ZeroState />}
      {showEarlyState && <EarlySendState />}

      {showDashboard && (
        <>
          <HeroSection metrics={metrics} />
          <FunnelStrip stages={funnelStages} />
          <ActivityFeed activity={recentActivity} />

          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #f1f5f9" }}>
            <Link href="/meetings" className="btn secondary" style={{ marginRight: "0.75rem" }}>
              All meetings
            </Link>
            <Link href="/replies" className="btn secondary">
              Reply inbox
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
