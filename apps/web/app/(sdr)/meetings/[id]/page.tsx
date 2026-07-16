import type { JSX } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { getMeeting, updateMeetingStatusAction } from "@/lib/sdr/booking";
import { getOrGenerateResearchBrief } from "@/lib/sdr/research-brief";
import type { MeetingWithProspect } from "@/lib/sdr/booking";
import type { FirmSnapshot } from "@/lib/sdr/research-brief";

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

// ─── Display helpers ──────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDurationMinutes(startAt: string, endAt: string): number {
  return Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  funding:         "Funding Round",
  leadership_hire: "Leadership Hire",
  product_launch:  "Product Launch",
  expansion:       "Expansion",
  job_posting:     "Active Hiring",
};

const TRIGGER_TYPE_ICONS: Record<string, string> = {
  funding:         "💰",
  leadership_hire: "👤",
  product_launch:  "🚀",
  expansion:       "🌍",
  job_posting:     "📋",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled:  { label: "Scheduled",  color: "#2563eb" },
  completed:  { label: "Completed",  color: "#16a34a" },
  no_show:    { label: "No Show",    color: "#dc2626" },
  cancelled:  { label: "Cancelled",  color: "#6b7280" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function BriefHeader({ meeting }: { meeting: MeetingWithProspect }): JSX.Element {
  const cfg = STATUS_CONFIG[meeting.meeting_status] ?? { label: meeting.meeting_status, color: "#6b7280" };
  const duration = getDurationMinutes(meeting.start_at, meeting.end_at);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* Back link */}
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/meetings" className="muted" style={{ fontSize: 13, textDecoration: "none" }}>
          ← Back to Meetings
        </Link>
      </div>

      {/* Brief headline */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ margin: "0 0 0.25rem" }}>
            {meeting.prospect_name}
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>
            {meeting.prospect_title ? `${meeting.prospect_title} · ` : ""}
            {meeting.prospect_company}
          </p>
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "4px 14px",
            borderRadius: 14,
            fontSize: 12,
            fontWeight: 700,
            background: `${cfg.color}15`,
            color: cfg.color,
            border: `1px solid ${cfg.color}40`,
          }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Meeting time */}
      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem 1rem",
          background: "#f8fafc",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{meeting.title}</div>
        <div className="muted">
          {formatDateTime(meeting.start_at)} · {duration} min
        </div>
        {meeting.attendee_email && (
          <div className="muted" style={{ marginTop: 2 }}>
            {meeting.attendee_email}
          </div>
        )}
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {meeting.calendar_link && (
            <a
              href={meeting.calendar_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn secondary"
              style={{ fontSize: 12, padding: "3px 10px" }}
            >
              Open in Google Calendar
            </a>
          )}
          {meeting.booking_link && !meeting.calendar_link && (
            <a
              href={meeting.booking_link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn secondary"
              style={{ fontSize: 12, padding: "3px 10px" }}
            >
              Open Booking Link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function FirmSnapshotCard({ snapshot }: { snapshot: FirmSnapshot }): JSX.Element {
  const fields: Array<{ label: string; value: string | null }> = [
    { label: "Company",   value: snapshot.company },
    { label: "Domain",    value: snapshot.domain },
    { label: "Vertical",  value: snapshot.vertical },
    { label: "Location",  value: snapshot.location },
    { label: "Team Size", value: snapshot.employeeCount ? `${snapshot.employeeCount} employees` : null },
    { label: "Revenue",   value: snapshot.revenueEstimate },
  ];

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.75rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#6b7280",
        }}
      >
        Firm Snapshot
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "0.5rem 1.5rem",
        }}
      >
        {fields.map(({ label, value }) =>
          value ? (
            <div key={label}>
              <div className="muted" style={{ fontSize: 11 }}>
                {label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
            </div>
          ) : null,
        )}
      </div>
      {snapshot.linkedinUrl && (
        <div style={{ marginTop: "0.75rem" }}>
          <a
            href={snapshot.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#2563eb" }}
          >
            LinkedIn Profile →
          </a>
        </div>
      )}
    </div>
  );
}

function TriggerEventCallout({
  triggerType,
  triggerTitle,
  meeting,
}: {
  triggerType: string | null;
  triggerTitle: string | null;
  meeting: MeetingWithProspect;
}): JSX.Element | null {
  if (!triggerType || !triggerTitle) return null;

  const icon = TRIGGER_TYPE_ICONS[triggerType] ?? "⚡";
  const typeLabel = TRIGGER_TYPE_LABELS[triggerType] ?? triggerType;

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        borderLeft: "3px solid #f59e0b",
        background: "#fffbeb",
      }}
    >
      <p
        style={{
          margin: "0 0 0.5rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#92400e",
        }}
      >
        {icon} Trigger Event — {typeLabel}
      </p>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1c1917" }}>
        {triggerTitle}
      </p>
      <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: 12 }}>
        This event triggered outreach to {meeting.prospect_name} at {meeting.prospect_company}.
        Reference it early in the call to show you did your homework.
      </p>
    </div>
  );
}

function ConversationSummaryCard({
  summary,
}: {
  summary: string | null;
}): JSX.Element {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.5rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#6b7280",
        }}
      >
        Conversation Thread
      </p>
      {summary ? (
        <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" as const, lineHeight: 1.7 }}>
          {summary}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          No outbound emails sent yet in this sequence.
        </p>
      )}
    </div>
  );
}

function TalkingPointsCard({ points }: { points: string[] }): JSX.Element {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.75rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#6b7280",
        }}
      >
        Suggested Talking Points
      </p>
      {points.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          No talking points generated yet.
        </p>
      ) : (
        <ol style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.7 }}>
          {points.map((point, idx) => (
            <li key={idx} style={{ fontSize: 13, marginBottom: "0.35rem" }}>
              {point}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AgendaCard({ agenda }: { agenda: string | null }): JSX.Element | null {
  if (!agenda) return null;
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.5rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#6b7280",
        }}
      >
        Pre-Populated Agenda
      </p>
      <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" as const, lineHeight: 1.7 }}>
        {agenda}
      </p>
    </div>
  );
}

function StatusUpdatePanel({
  meeting,
  orgId,
}: {
  meeting: MeetingWithProspect;
  orgId: string;
}): JSX.Element | null {
  if (meeting.meeting_status !== "scheduled") return null;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p
        style={{
          margin: "0 0 0.75rem",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          color: "#6b7280",
        }}
      >
        After the Call
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <form action={updateMeetingStatusAction}>
          <input type="hidden" name="meeting_id" value={meeting.id} />
          <input type="hidden" name="org_id" value={orgId} />
          <input type="hidden" name="status" value="completed" />
          <button type="submit" className="btn">
            Mark Completed
          </button>
        </form>
        <form action={updateMeetingStatusAction}>
          <input type="hidden" name="meeting_id" value={meeting.id} />
          <input type="hidden" name="org_id" value={orgId} />
          <input type="hidden" name="status" value="no_show" />
          <button type="submit" className="btn secondary">
            Mark No Show
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MeetingDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const orgId = await resolveOrgId();

  if (!orgId) {
    return (
      <main>
        <h1>Meeting Brief</h1>
        <p>Sign in to view this meeting brief.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const meeting = await getMeeting(orgId, params.id);
  if (!meeting) {
    notFound();
  }

  const brief = await getOrGenerateResearchBrief(orgId, meeting.id, meeting.prospect_id);

  const firmSnapshot = brief?.firm_snapshot ?? {
    company: meeting.prospect_company,
    domain: null,
    linkedinUrl: null,
    location: null,
    employeeCount: null,
    revenueEstimate: null,
    vertical: null,
    enrichmentData: {},
  };

  const talkingPoints: string[] = brief?.talking_points ?? [];
  const conversationSummary = brief?.conversation_summary ?? null;

  return (
    <main>
      {/* Brief headline + meeting time */}
      <BriefHeader meeting={meeting} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: "1.25rem",
          alignItems: "flex-start",
        }}
      >
        {/* Left column — brief dossier */}
        <div>
          {/* Trigger event callout (highest visual priority) */}
          <TriggerEventCallout
            triggerType={meeting.top_trigger_type}
            triggerTitle={meeting.top_trigger_title}
            meeting={meeting}
          />

          {/* Firm snapshot */}
          <FirmSnapshotCard snapshot={firmSnapshot as FirmSnapshot} />

          {/* Talking points */}
          <TalkingPointsCard points={talkingPoints} />

          {/* Conversation thread */}
          <ConversationSummaryCard summary={conversationSummary} />
        </div>

        {/* Right column — agenda + actions */}
        <div>
          <AgendaCard agenda={meeting.agenda} />
          <StatusUpdatePanel meeting={meeting} orgId={orgId} />

          {/* Brief metadata */}
          {brief && (
            <div className="card" style={{ fontSize: 12 }}>
              <p
                style={{
                  margin: "0 0 0.4rem",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.06em",
                  color: "#6b7280",
                }}
              >
                Brief Info
              </p>
              <p className="muted" style={{ margin: 0 }}>
                Generated {formatDate(brief.generated_at)}
              </p>
              {meeting.campaign_name && (
                <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                  Campaign: {meeting.campaign_name}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
