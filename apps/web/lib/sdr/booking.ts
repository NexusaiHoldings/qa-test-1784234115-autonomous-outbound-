"use server";

/**
 * Meeting booking logic for the SDR domain.
 *
 * Day-1 strategy: inject a Calendly/booking-link into the meeting record
 * while Google Calendar OAuth verification (Blocker B4) completes.
 * When calendar_event_id is present the meeting was written directly into
 * Google Calendar; otherwise booking_link is the fallback URL sent to the
 * prospect.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  org_id: string;
  prospect_id: string;
  reply_label_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  calendar_event_id: string | null;
  calendar_link: string | null;
  booking_link: string | null;
  meeting_status: string;
  attendee_email: string | null;
  agenda: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingWithProspect extends Meeting {
  prospect_name: string;
  prospect_email: string | null;
  prospect_company: string;
  prospect_title: string | null;
  top_trigger_type: string | null;
  top_trigger_title: string | null;
  campaign_name: string | null;
}

export interface CreateMeetingInput {
  prospectId: string;
  replyLabelId?: string;
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  attendeeEmail?: string;
  agenda?: string;
  bookingLink?: string;
}

export interface UpdateMeetingStatusInput {
  meetingId: string;
  status: "scheduled" | "completed" | "no_show" | "cancelled";
  notes?: string;
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

// ─── Google Calendar integration (day-1: booking-link fallback) ───────────────

/**
 * Attempts to write the meeting directly into the founder's Google Calendar
 * using the googleapis client. Returns the created event ID and HTML link on
 * success, or null when the OAuth credentials are not yet provisioned
 * (Blocker B4 — Google OAuth app verification pending).
 */
async function tryCreateGoogleCalendarEvent(params: {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  attendeeEmail: string | null;
  orgId: string;
}): Promise<{ eventId: string; htmlLink: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    // Exchange refresh token for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      return null;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) return null;

    // Build event body
    const eventBody: Record<string, unknown> = {
      summary: params.title,
      description: params.description,
      start: { dateTime: params.startAt, timeZone: "UTC" },
      end: { dateTime: params.endAt, timeZone: "UTC" },
    };

    if (params.attendeeEmail) {
      eventBody.attendees = [{ email: params.attendeeEmail }];
    }

    const calRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );

    if (!calRes.ok) {
      return null;
    }

    const calData = (await calRes.json()) as { id?: string; htmlLink?: string };
    if (!calData.id || !calData.htmlLink) return null;

    return { eventId: calData.id, htmlLink: calData.htmlLink };
  } catch {
    return null;
  }
}

/**
 * Build a pre-populated agenda string for the calendar event.
 */
function buildAgenda(params: {
  prospectName: string;
  prospectTitle: string | null;
  company: string;
  topTriggerTitle: string | null;
  topTriggerType: string | null;
}): string {
  const lines: string[] = [
    `Meeting with ${params.prospectName}${params.prospectTitle ? `, ${params.prospectTitle}` : ""} at ${params.company}`,
    "",
    "Agenda:",
    "1. Introductions (2 min)",
    "2. Their current challenges and priorities (10 min)",
  ];

  if (params.topTriggerTitle && params.topTriggerType) {
    const triggerLabel =
      params.topTriggerType === "funding"
        ? "recent funding round"
        : params.topTriggerType === "leadership_hire"
          ? "recent leadership change"
          : params.topTriggerType === "product_launch"
            ? "recent product launch"
            : params.topTriggerType === "expansion"
              ? "recent expansion"
              : "recent company development";
    lines.push(`3. Context on ${triggerLabel}: ${params.topTriggerTitle} (5 min)`);
    lines.push("4. Our solution and fit (10 min)");
    lines.push("5. Next steps (3 min)");
  } else {
    lines.push("3. Our solution and how it fits (10 min)");
    lines.push("4. Next steps (3 min)");
  }

  return lines.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a meeting from an interested reply. Attempts Google Calendar first,
 * falls back to booking_link injection when OAuth credentials are absent.
 */
export async function createMeeting(
  input: CreateMeetingInput,
): Promise<{ ok: true; meeting: Meeting } | { ok: false; error: string }> {
  const orgId = await resolveOrgId();
  if (!orgId) {
    return { ok: false, error: "Not authenticated" };
  }

  if (!input.prospectId) {
    return { ok: false, error: "prospectId is required" };
  }
  if (!input.title.trim()) {
    return { ok: false, error: "Meeting title is required" };
  }
  if (!input.startAt || !input.endAt) {
    return { ok: false, error: "start_at and end_at are required" };
  }

  const db = buildDb();

  // Fetch prospect context to build agenda
  const prospectRows = await db.query<{
    full_name: string;
    title: string | null;
    company: string;
    email: string | null;
  }>(
    `SELECT full_name, title, company, email
     FROM sdr_prospects
     WHERE id = $1 AND org_id = $2
     LIMIT 1`,
    input.prospectId,
    orgId,
  );

  const prospect = prospectRows[0];
  if (!prospect) {
    return { ok: false, error: "Prospect not found" };
  }

  // Fetch top trigger event for pre-populated agenda
  const triggerRows = await db.query<{
    event_type: string;
    event_title: string;
  }>(
    `SELECT event_type, event_title
     FROM sdr_prospect_trigger_events
     WHERE prospect_id = $1 AND org_id = $2 AND is_top_trigger = true
     ORDER BY relevance_score DESC
     LIMIT 1`,
    input.prospectId,
    orgId,
  );

  const topTrigger = triggerRows[0] ?? null;

  const attendeeEmail = input.attendeeEmail ?? prospect.email ?? null;

  const agenda =
    input.agenda ??
    buildAgenda({
      prospectName: prospect.full_name,
      prospectTitle: prospect.title,
      company: prospect.company,
      topTriggerTitle: topTrigger?.event_title ?? null,
      topTriggerType: topTrigger?.event_type ?? null,
    });

  const description =
    input.description ??
    `Introductory call with ${prospect.full_name} at ${prospect.company}.`;

  // Attempt Google Calendar integration (Blocker B4 fallback)
  const gcal = await tryCreateGoogleCalendarEvent({
    title: input.title,
    description: `${description}\n\n${agenda}`,
    startAt: input.startAt,
    endAt: input.endAt,
    attendeeEmail,
    orgId,
  });

  const bookingLink = input.bookingLink ?? process.env.DEFAULT_BOOKING_LINK ?? null;

  try {
    const rows = await db.query<Meeting>(
      `INSERT INTO sdr_meetings
         (org_id, prospect_id, reply_label_id, title, description,
          start_at, end_at, calendar_event_id, calendar_link,
          booking_link, meeting_status, attendee_email, agenda)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', $11, $12)
       RETURNING id, org_id, prospect_id, reply_label_id::text,
                 title, description, start_at::text, end_at::text,
                 calendar_event_id, calendar_link, booking_link,
                 meeting_status, attendee_email, agenda, notes,
                 created_at::text, updated_at::text`,
      orgId,
      input.prospectId,
      input.replyLabelId ?? null,
      input.title.trim(),
      description,
      input.startAt,
      input.endAt,
      gcal?.eventId ?? null,
      gcal?.htmlLink ?? null,
      bookingLink,
      attendeeEmail,
      agenda,
    );

    if (!rows[0]) {
      return { ok: false, error: "Insert failed" };
    }
    return { ok: true, meeting: rows[0] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { ok: false, error: message };
  }
}

/**
 * List all meetings for the org, joined with prospect details and top trigger.
 * Ordered by start_at ASC so upcoming meetings appear first.
 */
export async function listMeetings(orgId: string): Promise<MeetingWithProspect[]> {
  const db = buildDb();
  return db.query<MeetingWithProspect>(
    `SELECT
       m.id, m.org_id, m.prospect_id, m.reply_label_id::text,
       m.title, m.description, m.start_at::text, m.end_at::text,
       m.calendar_event_id, m.calendar_link, m.booking_link,
       m.meeting_status, m.attendee_email, m.agenda, m.notes,
       m.created_at::text, m.updated_at::text,
       p.full_name    AS prospect_name,
       p.email        AS prospect_email,
       p.company      AS prospect_company,
       p.title        AS prospect_title,
       te.event_type  AS top_trigger_type,
       te.event_title AS top_trigger_title,
       cq.campaign_name
     FROM sdr_meetings m
     JOIN sdr_prospects p ON p.id = m.prospect_id
     LEFT JOIN LATERAL (
       SELECT event_type, event_title
       FROM sdr_prospect_trigger_events
       WHERE prospect_id = m.prospect_id AND org_id = $1 AND is_top_trigger = true
       ORDER BY relevance_score DESC LIMIT 1
     ) te ON true
     LEFT JOIN LATERAL (
       SELECT c2.name AS campaign_name
       FROM sdr_email_sequences seq2
       JOIN sdr_campaigns c2 ON c2.id = seq2.campaign_id
       WHERE seq2.prospect_id = m.prospect_id AND seq2.org_id = $1
       ORDER BY seq2.created_at DESC LIMIT 1
     ) cq ON true
     WHERE m.org_id = $1
     ORDER BY m.start_at ASC
     LIMIT 200`,
    orgId,
  );
}

/**
 * Get a single meeting with full prospect details.
 */
export async function getMeeting(
  orgId: string,
  meetingId: string,
): Promise<MeetingWithProspect | null> {
  const db = buildDb();
  const rows = await db.query<MeetingWithProspect>(
    `SELECT
       m.id, m.org_id, m.prospect_id, m.reply_label_id::text,
       m.title, m.description, m.start_at::text, m.end_at::text,
       m.calendar_event_id, m.calendar_link, m.booking_link,
       m.meeting_status, m.attendee_email, m.agenda, m.notes,
       m.created_at::text, m.updated_at::text,
       p.full_name    AS prospect_name,
       p.email        AS prospect_email,
       p.company      AS prospect_company,
       p.title        AS prospect_title,
       te.event_type  AS top_trigger_type,
       te.event_title AS top_trigger_title,
       cq.campaign_name
     FROM sdr_meetings m
     JOIN sdr_prospects p ON p.id = m.prospect_id
     LEFT JOIN LATERAL (
       SELECT event_type, event_title
       FROM sdr_prospect_trigger_events
       WHERE prospect_id = m.prospect_id AND org_id = $1 AND is_top_trigger = true
       ORDER BY relevance_score DESC LIMIT 1
     ) te ON true
     LEFT JOIN LATERAL (
       SELECT c2.name AS campaign_name
       FROM sdr_email_sequences seq2
       JOIN sdr_campaigns c2 ON c2.id = seq2.campaign_id
       WHERE seq2.prospect_id = m.prospect_id AND seq2.org_id = $1
       ORDER BY seq2.created_at DESC LIMIT 1
     ) cq ON true
     WHERE m.id = $2 AND m.org_id = $1
     LIMIT 1`,
    orgId,
    meetingId,
  );
  return rows[0] ?? null;
}

/**
 * Update a meeting's show/no-show status after the call.
 */
export async function updateMeetingStatus(
  orgId: string,
  input: UpdateMeetingStatusInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = buildDb();
  try {
    await db.execute(
      `UPDATE sdr_meetings
          SET meeting_status = $3,
              notes          = COALESCE($4, notes),
              updated_at     = NOW()
        WHERE id = $2 AND org_id = $1`,
      orgId,
      input.meetingId,
      input.status,
      input.notes ?? null,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { ok: false, error: message };
  }
}

/**
 * Server action wrapper — called from meeting detail page forms.
 */
export async function updateMeetingStatusAction(formData: FormData): Promise<void> {
  const orgId = await resolveOrgId();
  if (!orgId) return;
  const meetingId = formData.get("meeting_id") as string | null;
  const status = formData.get("status") as string | null;
  const notes = formData.get("notes") as string | null;
  if (!meetingId || !status) return;
  await updateMeetingStatus(orgId, {
    meetingId,
    status: status as "scheduled" | "completed" | "no_show" | "cancelled",
    notes: notes ?? undefined,
  });
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
}
