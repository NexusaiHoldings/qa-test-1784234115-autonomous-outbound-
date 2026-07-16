/**
 * Agent tool handler: source_prospects
 *
 * Pulls and enriches new prospects for a campaign from Apollo + Proxycurl,
 * then writes verified rows into sdr_prospects. Called by the daily
 * prospect-refresh cycle. Autonomy = autonomous; mutation routes through
 * the cross-boundary bridge (confirm-gated).
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

interface Args {
  campaign_id: string;
  org_id: string;
  limit?: number;
  icp_filters?: Record<string, unknown>;
}

interface ApolloContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  organization_name: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  seniority: string | null;
}

interface ProxycurlProfile {
  full_name: string | null;
  headline: string | null;
  summary: string | null;
  experiences: Array<{ company: string; title: string; duration_short: string }>;
  skills: string[];
}

async function fetchApolloProspects(
  filters: Record<string, unknown>,
  limit: number
): Promise<ApolloContact[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error("APOLLO_API_KEY is not configured");
  }

  const body = {
    api_key: apiKey,
    page: 1,
    per_page: Math.min(limit, 100),
    person_seniorities: (filters.seniorities as string[]) ?? ["manager", "director", "vp", "c_suite"],
    person_titles: (filters.titles as string[]) ?? [],
    organization_industry_tag_ids: (filters.industry_tag_ids as string[]) ?? [],
    q_organization_num_employees_ranges: (filters.employee_ranges as string[]) ?? [],
    q_keywords: (filters.keywords as string) ?? "",
  };

  const response = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Apollo API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { people?: ApolloContact[] };
  return data.people ?? [];
}

async function enrichWithProxycurl(linkedinUrl: string): Promise<ProxycurlProfile | null> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://nubela.co/proxycurl/api/v2/linkedin");
  url.searchParams.set("linkedin_profile_url", linkedinUrl);
  url.searchParams.set("extra", "include");
  url.searchParams.set("skills", "include");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    full_name?: string;
    headline?: string;
    summary?: string;
    experiences?: Array<{ company: string; title: string; duration_short: string }>;
    skills?: string[];
  };

  return {
    full_name: data.full_name ?? null,
    headline: data.headline ?? null,
    summary: data.summary ?? null,
    experiences: data.experiences ?? [],
    skills: data.skills ?? [],
  };
}

export async function handleSourceProspects(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const { campaign_id, org_id, limit = 50, icp_filters = {} } = args as unknown as Args;

  if (!campaign_id || typeof campaign_id !== "string") {
    return { status: 400, body: "campaign_id is required" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { status: 400, body: "org_id is required" };
  }

  // Verify campaign belongs to org
  const campaignRows = await ctx.db.query<{ id: string; name: string }>(
    "SELECT id, name FROM sdr_campaigns WHERE id = $1 AND org_id = $2",
    campaign_id,
    org_id
  );
  const campaign = campaignRows[0];
  if (!campaign) {
    return { status: 404, body: "Campaign not found" };
  }

  // Fetch prospects from Apollo
  let apolloContacts: ApolloContact[];
  try {
    apolloContacts = await fetchApolloProspects(icp_filters, limit as number);
  } catch (error) {
    return {
      status: 502,
      body: `Failed to fetch from Apollo: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (apolloContacts.length === 0) {
    return {
      status: 200,
      body: {
        inserted: 0,
        skipped: 0,
        message: "No prospects returned by Apollo for the given filters",
      },
    };
  }

  // Deduplicate against existing prospects in this campaign
  const existingEmailRows = await ctx.db.query<{ email: string }>(
    "SELECT email FROM sdr_prospects WHERE org_id = $1 AND campaign_id = $2 AND email IS NOT NULL",
    org_id,
    campaign_id
  );
  const existingEmailSet = new Set(existingEmailRows.map((r) => r.email.toLowerCase()));

  const newContacts = apolloContacts.filter(
    (c) => c.email && !existingEmailSet.has(c.email.toLowerCase())
  );

  let inserted = 0;
  let skipped = apolloContacts.length - newContacts.length;

  for (const contact of newContacts) {
    // Optionally enrich with Proxycurl if LinkedIn URL is available
    let enrichmentJson: string | null = null;
    if (contact.linkedin_url) {
      try {
        const profile = await enrichWithProxycurl(contact.linkedin_url);
        if (profile) {
          enrichmentJson = JSON.stringify(profile);
        }
      } catch {
        // Enrichment is best-effort; continue without it
      }
    }

    const prospectId = crypto.randomUUID();

    try {
      await ctx.db.execute(
        `INSERT INTO sdr_prospects (
          id, org_id, campaign_id,
          first_name, last_name, email,
          title, company_name,
          linkedin_url, city, state, country,
          seniority, apollo_id,
          enrichment_json, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6,
          $7, $8,
          $9, $10, $11, $12,
          $13, $14,
          $15, 'new', NOW(), NOW()
        )
        ON CONFLICT (org_id, email) DO NOTHING`,
        prospectId,
        org_id,
        campaign_id,
        contact.first_name,
        contact.last_name,
        contact.email,
        contact.title,
        contact.organization_name,
        contact.linkedin_url,
        contact.city,
        contact.state,
        contact.country,
        contact.seniority,
        contact.id,
        enrichmentJson
      );
      inserted++;
    } catch {
      skipped++;
    }
  }

  return {
    status: 200,
    body: {
      campaign_id,
      campaign_name: campaign.name,
      fetched: apolloContacts.length,
      inserted,
      skipped,
      message: `Sourced ${inserted} new prospects for campaign "${campaign.name}"`,
    },
  };
}
