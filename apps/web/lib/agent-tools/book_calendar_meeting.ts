/**
 * Agent tool handler: book_calendar_meeting
 *
 * Confirm-gated mutation. Writes the confirmed meeting into the founder's
 * connected Google Calendar with agenda + brief link; called after a reply
 * is classified meeting-confirmed.
 *
 * Autonomy = confirm — mutations route through the cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

interface Args {
  touch_id: string;
  org_id: string;
  prospect_id: string;
  title: string;
  start_time: string;
  end_time: string;
  agenda: string;
  brief_link: string;
  timezone?: string;
  attendee_email?: string;
  calendar_id?: string;
}

interface TouchRow {
  id: string;
  status: string;
  prospect_id: string;
}

interface ProspectRow {
  id: string;
  full_name: string;
  email: string | null;
  title: string | null;
  company: string;
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface GoogleCalendarEvent {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  error?: { code: number; message: string };
}

async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Calendar credentials are not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALENDAR_REFRESH_TOKEN."
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || data.error) {
    throw new Error(
      `Google OAuth token refresh failed: ${data.error ?? "unknown"} — ${data.error_description ?? ""}`
    );
  }

  return data.access_token;
}

async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  summary: string,
  description: string,
  startDateTime: string,
  endDateTime: string,
  timezone: string,
  attendeeEmail: string | null
): Promise<GoogleCalendarEvent> {
  const attendees = attendeeEmail ? [{ email: attendeeEmail }] : [];

  const eventBody = {
    summary,
    description,
    start: { dateTime: startDateTime, timeZone: timezone },
    end: { dateTime: endDateTime, timeZone: timezone },
    attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "popup", minutes: 15 },
      ],
    },
  };

  const encodedCalendarId = encodeURIComponent(calendarId);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    }
  );

  const data = (await response.json()) as GoogleCalendarEvent;

  if (!response.ok) {
    throw new Error(
      `Google Calendar API error: HTTP ${response.status} — ${data.error?.message ?? "unknown error"}`
    );
  }

  return data;
}

export async function handleBookCalendarMeeting(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const {
    touch_id,
    org_id,
    prospect_id,
    title,
    start_time,
    end_time,
    agenda,
    brief_link,
    timezone = "UTC",
    attendee_email,
    calendar_id = "primary",
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
  if (!title || typeof title !== "string") {
    return { status: 400, body: "title is required" };
  }
  if (!start_time || typeof start_time !== "string") {
    return { status: 400, body: "start_time is required (ISO 8601 dateTime)" };
  }
  if (!end_time || typeof end_time !== "string") {
    return { status: 400, body: "end_time is required (ISO 8601 dateTime)" };
  }
  if (!agenda || typeof agenda !== "string") {
    return { status: 400, body: "agenda is required" };
  }
  if (!brief_link || typeof brief_link !== "string") {
    return { status: 400, body: "brief_link is required" };
  }

  // Validate ISO 8601 dateTime format
  const startDate = new Date(start_time);
  const endDate = new Date(end_time);
  if (isNaN(startDate.getTime())) {
    return { status: 400, body: "start_time must be a valid ISO 8601 dateTime string" };
  }
  if (isNaN(endDate.getTime())) {
    return { status: 400, body: "end_time must be a valid ISO 8601 dateTime string" };
  }
  if (endDate <= startDate) {
    return { status: 400, body: "end_time must be after start_time" };
  }

  // Verify the touch belongs to this org and prospect
  const touchRows = await ctx.db.query<TouchRow>(
    `SELECT id, status, prospect_id
       FROM sdr_sequence_touches
      WHERE id = $1 AND org_id = $2`,
    touch_id,
    org_id
  );
  const touch = touchRows[0];
  if (!touch) {
    return { status: 404, body: "Sequence touch not found for this org" };
  }
  if (touch.prospect_id !== prospect_id) {
    return { status: 409, body: "prospect_id does not match the touch record" };
  }

  // Load the prospect to get contact details
  const prospectRows = await ctx.db.query<ProspectRow>(
    `SELECT id, full_name, email, title, company
       FROM sdr_prospects
      WHERE id = $1 AND org_id = $2`,
    prospect_id,
    org_id
  );
  const prospect = prospectRows[0];
  if (!prospect) {
    return { status: 404, body: "Prospect not found for this org" };
  }

  // Resolve the attendee email: prefer explicit arg, fall back to prospect's email
  const resolvedAttendeeEmail =
    (attendee_email && typeof attendee_email === "string" ? attendee_email : null) ??
    prospect.email;

  // Build event summary and description
  const eventSummary = title;
  const eventDescription = [
    `AGENDA`,
    `-------`,
    agenda,
    ``,
    `Brief / Context`,
    `---------------`,
    brief_link,
    ``,
    `Prospect: ${prospect.full_name}${prospect.title ? ` (${prospect.title})` : ""}, ${prospect.company}`,
  ].join("\n");

  // Obtain a Google OAuth access token via the configured refresh token
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (error) {
    return {
      status: 502,
      body: `Failed to obtain Google Calendar access token: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Create the calendar event
  let calendarEvent: GoogleCalendarEvent;
  try {
    calendarEvent = await createCalendarEvent(
      accessToken,
      calendar_id,
      eventSummary,
      eventDescription,
      start_time,
      end_time,
      typeof timezone === "string" ? timezone : "UTC",
      resolvedAttendeeEmail
    );
  } catch (error) {
    return {
      status: 502,
      body: `Google Calendar event creation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Mark the touch as meeting-booked so downstream state machines can proceed
  await ctx.db.execute(
    `UPDATE sdr_sequence_touches
        SET status = 'meeting_booked',
            updated_at = NOW()
      WHERE id = $1 AND org_id = $2`,
    touch_id,
    org_id
  );

  return {
    status: 200,
    body: {
      touch_id,
      prospect_id,
      org_id,
      calendar_event_id: calendarEvent.id,
      calendar_event_url: calendarEvent.htmlLink,
      title: calendarEvent.summary,
      start_time: calendarEvent.start.dateTime,
      end_time: calendarEvent.end.dateTime,
      timezone: calendarEvent.start.timeZone,
      attendee_email: resolvedAttendeeEmail,
      prospect_name: prospect.full_name,
      prospect_company: prospect.company,
      message: `Meeting "${eventSummary}" booked on Google Calendar for ${prospect.full_name} at ${prospect.company}`,
    },
  };
}
