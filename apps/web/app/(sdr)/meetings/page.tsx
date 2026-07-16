import type { JSX } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { listMeetings } from "@/lib/sdr/booking";
import type { MeetingWithProspect } from "@/lib/sdr/booking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// ─── Countdown helpers ────────────────────────────────────────────────────────

function getCountdownLabel(startAt: string): { label: string; urgent: boolean; past: boolean } {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const diffMs = start - now;
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMs < 0) {
    const pastMin = Math.abs(diffMin);
    if (pastMin < 60) return { label: `${pastMin}m ago`, urgent: false, past: true };
    const pastHr = Math.floor(pastMin / 60);
    if (pastHr < 24) return { label: `${pastHr}h ago`, urgent: false, past: true };
    return { label: `${Math.floor(pastHr / 24)}d ago`, urgent: false, past: true };
  }
  if (diffMin < 60) return { label: `in ${diffMin}m`, urgent: diffMin <= 30, past: false };
  const hrs = Math.floor(diffMin / 60);
  if (hrs < 24) return { label: `in ${hrs}h`, urgent: hrs <= 2, past: false };
  const days = Math.floor(hrs / 24);
  return { label: `in ${days}d`, urgent: false, past: false };
}

function formatMeetingTime(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr} · ${startTime} – ${endTime}`;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:  { label: "Scheduled",  color: "#2563eb", bg: "#eff6ff" },
  completed:  { label: "Completed",  color: "#16a34a", bg: "#f0fdf4" },
  no_show:    { label: "No Show",    color: "#dc2626", bg: "#fef2f2" },
  cancelled:  { label: "Cancelled",  color: "#6b7280", bg: "#f9fafb" },
};

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  funding:        "Funding",
  leadership_hire: "New Leadership",
  product_launch: "Product Launch",
  expansion:      "Expansion",
  job_posting:    "Hiring",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }): JSX.Element {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "#6b7280", bg: "#f9fafb" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.color}30`,
        whiteSpace: "nowrap" as const,
      }}
    >
      {cfg.label}
    </span>
  );
}

function CountdownChip({
  startAt,
  status,
}: {
  startAt: string;
  status: string;
}): JSX.Element | null {
  if (status !== "scheduled") return null;
  const { label, urgent, past } = getCountdownLabel(startAt);
  const color = past ? "#6b7280" : urgent ? "#dc2626" : "#16a34a";
  const bg = past ? "#f9fafb" : urgent ? "#fef2f2" : "#f0fdf4";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
        border: `1px solid ${color}30`,
        whiteSpace: "nowrap" as const,
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </span>
  );
}

function TriggerPill({ triggerType }: { triggerType: string }): JSX.Element {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        background: "#fef9c320",
        color: "#a16207",
        border: "1px solid #fde04740",
        whiteSpace: "nowrap" as const,
      }}
    >
      {TRIGGER_TYPE_LABELS[triggerType] ?? triggerType}
    </span>
  );
}

function MeetingCard({ meeting }: { meeting: MeetingWithProspect }): JSX.Element {
  const timeStr = formatMeetingTime(meeting.start_at, meeting.end_at);
  const calSource = meeting.calendar_event_id
    ? "Google Calendar"
    : meeting.booking_link
      ? "Booking Link"
      : null;

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      style={{ textDecoration: "none", display: "block", marginBottom: "0.75rem" }}
    >
      <div
        className="card"
        style={{
          cursor: "pointer",
          borderLeft: meeting.meeting_status === "scheduled" ? "3px solid #2563eb" : undefined,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: "0.4rem",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {meeting.prospect_name}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {meeting.prospect_title ? `${meeting.prospect_title} · ` : ""}
              {meeting.prospect_company}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <CountdownChip startAt={meeting.start_at} status={meeting.meeting_status} />
            <StatusBadge status={meeting.meeting_status} />
          </div>
        </div>

        {/* Time row */}
        <div
          className="muted"
          style={{ fontSize: 12, marginBottom: "0.4rem" }}
        >
          {timeStr}
        </div>

        {/* Meeting title + campaign */}
        <div style={{ fontSize: 13, marginBottom: "0.4rem" }}>
          {meeting.title}
          {meeting.campaign_name && (
            <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
              via {meeting.campaign_name}
            </span>
          )}
        </div>

        {/* Tags row */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          {meeting.top_trigger_type && (
            <TriggerPill triggerType={meeting.top_trigger_type} />
          )}
          {calSource && (
            <span
              className="muted"
              style={{ fontSize: 10 }}
            >
              {calSource}
            </span>
          )}
          {meeting.attendee_email && (
            <span className="muted" style={{ fontSize: 10 }}>
              {meeting.attendee_email}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Stat summary ─────────────────────────────────────────────────────────────

function MeetingStats({
  meetings,
}: {
  meetings: MeetingWithProspect[];
}): JSX.Element {
  const upcoming = meetings.filter((m) => m.meeting_status === "scheduled").length;
  const completed = meetings.filter((m) => m.meeting_status === "completed").length;
  const noShow = meetings.filter((m) => m.meeting_status === "no_show").length;

  return (
    <div
      style={{
        display: "flex",
        gap: "1.5rem",
        flexWrap: "wrap",
        marginBottom: "1.5rem",
        padding: "0.75rem 1rem",
        background: "#f8fafc",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        fontSize: 13,
      }}
    >
      <div>
        <span className="muted">Upcoming: </span>
        <strong style={{ color: "#2563eb" }}>{upcoming}</strong>
      </div>
      <div>
        <span className="muted">Completed: </span>
        <strong style={{ color: "#16a34a" }}>{completed}</strong>
      </div>
      {noShow > 0 && (
        <div>
          <span className="muted">No Show: </span>
          <strong style={{ color: "#dc2626" }}>{noShow}</strong>
        </div>
      )}
      <div>
        <span className="muted">Total: </span>
        <strong>{meetings.length}</strong>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}): Promise<JSX.Element> {
  const orgId = await resolveOrgId();

  if (!orgId) {
    return (
      <main>
        <h1>Meetings</h1>
        <p>Sign in to view your booked meetings.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const allMeetings = await listMeetings(orgId);
  const filter = searchParams.filter ?? "all";

  const filtered =
    filter === "upcoming"
      ? allMeetings.filter((m) => m.meeting_status === "scheduled")
      : filter === "completed"
        ? allMeetings.filter((m) => m.meeting_status === "completed")
        : filter === "no_show"
          ? allMeetings.filter((m) => m.meeting_status === "no_show")
          : allMeetings;

  if (allMeetings.length === 0) {
    return (
      <main>
        <h1>Meetings</h1>
        <p>
          Booked calls with interested prospects — each includes a pre-populated agenda
          and AI-compiled research brief.
        </p>
        <div className="empty" style={{ marginTop: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📅</div>
          <h2 style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            No meetings booked yet
          </h2>
          <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem" }}>
            When a prospect replies with interest, a meeting is automatically
            booked with a pre-populated agenda and a prospect research brief
            so you can walk into every call prepared.
          </p>
          <Link href="/replies" className="btn secondary">
            View Reply Inbox
          </Link>
        </div>
      </main>
    );
  }

  const upcomingCount = allMeetings.filter((m) => m.meeting_status === "scheduled").length;

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
        <h1 style={{ margin: 0 }}>Meetings</h1>
        {upcomingCount > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              background: "#eff6ff",
              color: "#2563eb",
              border: "1px solid #bfdbfe",
            }}
          >
            {upcomingCount} upcoming
          </span>
        )}
      </div>
      <p>
        Each meeting includes a pre-populated agenda and AI-compiled research brief — open
        the brief 5 minutes before the call to walk in prepared.
      </p>

      <MeetingStats meetings={allMeetings} />

      {/* Filter toolbar */}
      <div className="toolbar" style={{ marginBottom: "1.5rem" }}>
        {(
          [
            { key: "all", label: "All" },
            { key: "upcoming", label: "Upcoming" },
            { key: "completed", label: "Completed" },
            { key: "no_show", label: "No Show" },
          ] as const
        ).map(({ key, label }) => (
          <Link
            key={key}
            href={`/meetings?filter=${key}`}
            style={{
              padding: "4px 14px",
              borderRadius: 16,
              fontSize: 13,
              fontWeight: filter === key ? 600 : 400,
              background: filter === key ? "#2563eb" : "#f1f5f9",
              color: filter === key ? "#fff" : "#374151",
              textDecoration: "none",
              border: filter === key ? "1px solid #2563eb" : "1px solid #e2e8f0",
              whiteSpace: "nowrap" as const,
            }}
          >
            {label}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="muted">No meetings match this filter.</p>
        </div>
      ) : (
        <div>
          {filtered.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      )}
    </main>
  );
}
