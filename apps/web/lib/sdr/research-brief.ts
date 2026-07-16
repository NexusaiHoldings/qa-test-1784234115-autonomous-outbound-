"use server";

/**
 * Prospect research brief compiler for the SDR domain.
 *
 * Compiles a structured dossier from sourcing enrichment data,
 * trigger events, and conversation history, then calls the AI gateway
 * (gpt-5.4-mini) to generate suggested talking points.
 *
 * The brief is what the founder opens 5 minutes before the call:
 *   - Firm snapshot (firmographics)
 *   - Top trigger event callout
 *   - Conversation summary (subject lines + touch count)
 *   - AI-generated talking points
 */

import { buildDb } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirmSnapshot {
  company: string;
  domain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  employeeCount: number | null;
  revenueEstimate: string | null;
  vertical: string | null;
  enrichmentData: Record<string, unknown>;
}

export interface TriggerEventSummary {
  eventType: string;
  eventTitle: string;
  eventDescription: string | null;
  eventDate: string | null;
  relevanceScore: number;
  sourceUrl: string | null;
  isTopTrigger: boolean;
}

export interface ResearchBrief {
  id: string;
  org_id: string;
  meeting_id: string;
  prospect_id: string;
  firm_snapshot: FirmSnapshot;
  top_trigger_event_id: string | null;
  conversation_summary: string | null;
  talking_points: string[];
  generated_at: string;
  created_at: string;
  updated_at: string;
}

interface ProspectContext {
  fullName: string;
  email: string | null;
  title: string | null;
  company: string;
  domain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  employeeCount: number | null;
  revenueEstimate: string | null;
  enrichmentData: Record<string, unknown>;
  triggerEvents: TriggerEventSummary[];
  touches: Array<{
    touchNumber: number;
    subject: string;
    sentAt: string | null;
    status: string;
  }>;
  campaignVertical: string | null;
}

// ─── Context compiler ─────────────────────────────────────────────────────────

async function compileProspectContext(
  orgId: string,
  prospectId: string,
): Promise<ProspectContext | null> {
  const db = buildDb();

  const prospectRows = await db.query<{
    full_name: string;
    email: string | null;
    title: string | null;
    company: string;
    company_domain: string | null;
    linkedin_url: string | null;
    location: string | null;
    employee_count: number | null;
    revenue_estimate: string | null;
    enrichment_data: string | Record<string, unknown>;
    campaign_id: string;
  }>(
    `SELECT p.full_name, p.email, p.title, p.company,
            p.company_domain, p.linkedin_url, p.location,
            p.employee_count, p.revenue_estimate, p.enrichment_data,
            p.campaign_id
     FROM sdr_prospects p
     WHERE p.id = $1 AND p.org_id = $2
     LIMIT 1`,
    prospectId,
    orgId,
  );

  const prospect = prospectRows[0];
  if (!prospect) return null;

  let enrichmentData: Record<string, unknown> = {};
  if (typeof prospect.enrichment_data === "string") {
    try {
      enrichmentData = JSON.parse(prospect.enrichment_data) as Record<string, unknown>;
    } catch {
      enrichmentData = {};
    }
  } else if (prospect.enrichment_data && typeof prospect.enrichment_data === "object") {
    enrichmentData = prospect.enrichment_data as Record<string, unknown>;
  }

  // Fetch trigger events
  const triggerRows = await db.query<{
    event_type: string;
    event_title: string;
    event_description: string | null;
    event_date: string | null;
    relevance_score: string;
    source_url: string | null;
    is_top_trigger: boolean;
  }>(
    `SELECT event_type, event_title, event_description,
            event_date::text, relevance_score::text, source_url, is_top_trigger
     FROM sdr_prospect_trigger_events
     WHERE prospect_id = $1 AND org_id = $2
     ORDER BY relevance_score DESC
     LIMIT 10`,
    prospectId,
    orgId,
  );

  const triggerEvents: TriggerEventSummary[] = triggerRows.map((te) => ({
    eventType: te.event_type,
    eventTitle: te.event_title,
    eventDescription: te.event_description,
    eventDate: te.event_date,
    relevanceScore: parseFloat(te.relevance_score) || 0,
    sourceUrl: te.source_url,
    isTopTrigger: te.is_top_trigger,
  }));

  // Fetch sequence touches (conversation history)
  const touchRows = await db.query<{
    touch_number: number;
    subject: string;
    sent_at: string | null;
    status: string;
  }>(
    `SELECT t.touch_number, t.subject, t.sent_at::text, t.status
     FROM sdr_sequence_touches t
     JOIN sdr_email_sequences seq ON seq.id = t.sequence_id
     WHERE seq.prospect_id = $1 AND seq.org_id = $2
     ORDER BY t.touch_number ASC`,
    prospectId,
    orgId,
  );

  // Fetch campaign vertical
  const campaignRows = await db.query<{ vertical: string }>(
    `SELECT c.vertical
     FROM sdr_campaigns c
     WHERE c.id = $1 AND c.org_id = $2
     LIMIT 1`,
    prospect.campaign_id,
    orgId,
  );

  return {
    fullName: prospect.full_name,
    email: prospect.email,
    title: prospect.title,
    company: prospect.company,
    domain: prospect.company_domain,
    linkedinUrl: prospect.linkedin_url,
    location: prospect.location,
    employeeCount: prospect.employee_count,
    revenueEstimate: prospect.revenue_estimate,
    enrichmentData,
    triggerEvents,
    touches: touchRows,
    campaignVertical: campaignRows[0]?.vertical ?? null,
  };
}

// ─── Conversation summary builder ─────────────────────────────────────────────

function buildConversationSummary(
  touches: ProspectContext["touches"],
): string {
  if (touches.length === 0) {
    return "No outbound emails sent yet in this sequence.";
  }

  const sent = touches.filter((t) => t.status === "sent" || t.sent_at);
  const pending = touches.filter((t) => t.status === "queued" || t.status === "scheduled");

  const lines: string[] = [];
  lines.push(`${sent.length} of ${touches.length} email touch${touches.length !== 1 ? "es" : ""} sent.`);

  sent.forEach((t) => {
    const dateStr = t.sent_at
      ? new Date(t.sent_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "unknown date";
    lines.push(`  Touch ${t.touch_number}: "${t.subject}" (sent ${dateStr})`);
  });

  if (pending.length > 0) {
    lines.push(`${pending.length} touch${pending.length !== 1 ? "es" : ""} pending in queue.`);
  }

  return lines.join("\n");
}

// ─── AI talking points generator ─────────────────────────────────────────────

async function generateTalkingPoints(ctx: ProspectContext): Promise<string[]> {
  const baseUrl = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com";
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  const topTrigger = ctx.triggerEvents.find((te) => te.isTopTrigger) ?? ctx.triggerEvents[0];

  const systemPrompt = `You are an expert B2B sales coach helping a founder prepare for a discovery call.
Generate 4-6 specific, actionable talking points for the meeting.
Each talking point should be a single sentence starting with an action verb.
Return ONLY valid JSON: { "talking_points": ["point 1", "point 2", ...] }
Make points specific to the prospect's industry, company situation, and any recent trigger events.`;

  const userPrompt = `PROSPECT: ${ctx.fullName}${ctx.title ? `, ${ctx.title}` : ""} at ${ctx.company}
VERTICAL: ${ctx.campaignVertical ?? "B2B services"}
COMPANY SIZE: ${ctx.employeeCount ? `${ctx.employeeCount} employees` : "unknown"}
REVENUE: ${ctx.revenueEstimate ?? "unknown"}
LOCATION: ${ctx.location ?? "unknown"}

${topTrigger ? `TOP TRIGGER EVENT (${topTrigger.eventType}): ${topTrigger.eventTitle}${topTrigger.eventDescription ? ` — ${topTrigger.eventDescription}` : ""}` : "No trigger event identified"}

${ctx.triggerEvents.length > 1 ? `OTHER SIGNALS:\n${ctx.triggerEvents.slice(1, 4).map((te) => `- ${te.eventType}: ${te.eventTitle}`).join("\n")}` : ""}

OUTREACH HISTORY: ${ctx.touches.length > 0 ? `${ctx.touches.length} email${ctx.touches.length !== 1 ? "s" : ""} sent in sequence` : "No emails sent yet"}

Generate focused talking points for the discovery call.`;

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return buildFallbackTalkingPoints(ctx);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content;
    if (!content) return buildFallbackTalkingPoints(ctx);

    const parsed = JSON.parse(content) as { talking_points?: unknown[] };
    const points = parsed.talking_points;
    if (!Array.isArray(points) || points.length === 0) {
      return buildFallbackTalkingPoints(ctx);
    }
    return points
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .slice(0, 6);
  } catch {
    return buildFallbackTalkingPoints(ctx);
  }
}

function buildFallbackTalkingPoints(ctx: ProspectContext): string[] {
  const points: string[] = [
    `Ask ${ctx.fullName} what their top operational priority is for the next quarter.`,
    `Understand how ${ctx.company} currently handles the core workflow gap we solve.`,
    `Explore what a successful outcome from this conversation looks like for them.`,
  ];

  const topTrigger = ctx.triggerEvents.find((te) => te.isTopTrigger);
  if (topTrigger) {
    if (topTrigger.eventType === "funding") {
      points.push(`Reference their recent funding and ask how they plan to deploy it for growth.`);
    } else if (topTrigger.eventType === "leadership_hire") {
      points.push(`Acknowledge the recent leadership change and ask about new strategic priorities.`);
    } else if (topTrigger.eventType === "product_launch") {
      points.push(`Congratulate them on the recent product launch and ask about GTM challenges.`);
    } else if (topTrigger.eventType === "expansion") {
      points.push(`Discuss how the recent expansion is affecting their operational complexity.`);
    }
  }

  points.push(`Agree on a clear next step before the call ends — trial, proposal, or follow-up.`);
  return points;
}

// ─── Brief persistence ────────────────────────────────────────────────────────

/**
 * Generate and persist a research brief for a given meeting.
 * If a brief already exists for the meeting, regenerate it.
 */
export async function generateResearchBrief(
  orgId: string,
  meetingId: string,
  prospectId: string,
): Promise<ResearchBrief | null> {
  const db = buildDb();

  const ctx = await compileProspectContext(orgId, prospectId);
  if (!ctx) return null;

  const firmSnapshot: FirmSnapshot = {
    company: ctx.company,
    domain: ctx.domain,
    linkedinUrl: ctx.linkedinUrl,
    location: ctx.location,
    employeeCount: ctx.employeeCount,
    revenueEstimate: ctx.revenueEstimate,
    vertical: ctx.campaignVertical,
    enrichmentData: ctx.enrichmentData,
  };

  const conversationSummary = buildConversationSummary(ctx.touches);
  const talkingPoints = await generateTalkingPoints(ctx);

  // Find top trigger event id for FK reference
  const topTriggerRows = await db.query<{ id: string }>(
    `SELECT id FROM sdr_prospect_trigger_events
     WHERE prospect_id = $1 AND org_id = $2 AND is_top_trigger = true
     ORDER BY relevance_score DESC LIMIT 1`,
    prospectId,
    orgId,
  );
  const topTriggerEventId = topTriggerRows[0]?.id ?? null;

  // Upsert — one brief per meeting
  const rows = await db.query<ResearchBrief>(
    `INSERT INTO sdr_research_briefs
       (org_id, meeting_id, prospect_id, firm_snapshot, top_trigger_event_id,
        conversation_summary, talking_points, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (meeting_id)
     DO UPDATE SET
       firm_snapshot        = EXCLUDED.firm_snapshot,
       top_trigger_event_id = EXCLUDED.top_trigger_event_id,
       conversation_summary = EXCLUDED.conversation_summary,
       talking_points       = EXCLUDED.talking_points,
       generated_at         = NOW(),
       updated_at           = NOW()
     RETURNING id, org_id, meeting_id, prospect_id,
               firm_snapshot, top_trigger_event_id::text,
               conversation_summary, talking_points,
               generated_at::text, created_at::text, updated_at::text`,
    orgId,
    meetingId,
    prospectId,
    JSON.stringify(firmSnapshot),
    topTriggerEventId,
    conversationSummary,
    JSON.stringify(talkingPoints),
  );

  const row = rows[0];
  if (!row) return null;

  return normalizeBriefRow(row);
}

/**
 * Fetch an existing research brief for a meeting.
 */
export async function getResearchBrief(
  orgId: string,
  meetingId: string,
): Promise<ResearchBrief | null> {
  const db = buildDb();
  const rows = await db.query<ResearchBrief>(
    `SELECT id, org_id, meeting_id, prospect_id,
            firm_snapshot, top_trigger_event_id::text,
            conversation_summary, talking_points,
            generated_at::text, created_at::text, updated_at::text
     FROM sdr_research_briefs
     WHERE meeting_id = $1 AND org_id = $2
     LIMIT 1`,
    meetingId,
    orgId,
  );

  const row = rows[0];
  if (!row) return null;
  return normalizeBriefRow(row);
}

/**
 * Get existing brief or generate a new one if it doesn't exist.
 */
export async function getOrGenerateResearchBrief(
  orgId: string,
  meetingId: string,
  prospectId: string,
): Promise<ResearchBrief | null> {
  const existing = await getResearchBrief(orgId, meetingId);
  if (existing) return existing;
  return generateResearchBrief(orgId, meetingId, prospectId);
}

// ─── Row normalizer ───────────────────────────────────────────────────────────

function normalizeBriefRow(row: ResearchBrief): ResearchBrief {
  let firmSnapshot = row.firm_snapshot;
  if (typeof firmSnapshot === "string") {
    try {
      firmSnapshot = JSON.parse(firmSnapshot) as FirmSnapshot;
    } catch {
      firmSnapshot = { company: "", domain: null, linkedinUrl: null, location: null, employeeCount: null, revenueEstimate: null, vertical: null, enrichmentData: {} };
    }
  }

  let talkingPoints = row.talking_points;
  if (typeof talkingPoints === "string") {
    try {
      talkingPoints = JSON.parse(talkingPoints) as string[];
    } catch {
      talkingPoints = [];
    }
  }

  return {
    ...row,
    firm_snapshot: firmSnapshot as FirmSnapshot,
    talking_points: Array.isArray(talkingPoints) ? (talkingPoints as string[]) : [],
  };
}

// ─── Trigger event detail loader (for the brief display) ─────────────────────

export async function getTopTriggerEvent(
  orgId: string,
  prospectId: string,
): Promise<TriggerEventSummary | null> {
  const db = buildDb();
  const rows = await db.query<{
    event_type: string;
    event_title: string;
    event_description: string | null;
    event_date: string | null;
    relevance_score: string;
    source_url: string | null;
    is_top_trigger: boolean;
  }>(
    `SELECT event_type, event_title, event_description,
            event_date::text, relevance_score::text, source_url, is_top_trigger
     FROM sdr_prospect_trigger_events
     WHERE prospect_id = $1 AND org_id = $2 AND is_top_trigger = true
     ORDER BY relevance_score DESC
     LIMIT 1`,
    prospectId,
    orgId,
  );

  const row = rows[0];
  if (!row) return null;
  return {
    eventType: row.event_type,
    eventTitle: row.event_title,
    eventDescription: row.event_description,
    eventDate: row.event_date,
    relevanceScore: parseFloat(row.relevance_score) || 0,
    sourceUrl: row.source_url,
    isTopTrigger: row.is_top_trigger,
  };
}
