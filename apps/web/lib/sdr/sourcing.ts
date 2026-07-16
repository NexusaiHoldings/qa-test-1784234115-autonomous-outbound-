"use server";

import { buildDb } from "@/lib/db";
import { rankTriggerEvents, fetchTriggerEventsForCompany } from "./trigger-ranking";

export type EmailVerificationStatus = "verified" | "risky" | "invalid" | "unverified";

export interface ApolloContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string | null;
  email_status: string | null;
  title: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization_name: string | null;
  organization: {
    name: string;
    website_url: string | null;
    linkedin_url: string | null;
    estimated_num_employees: number | null;
    annual_revenue_printed: string | null;
    primary_domain: string | null;
  } | null;
}

export interface ProxycurlProfile {
  full_name: string | null;
  occupation: string | null;
  headline: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  country_full_name: string | null;
  experiences: Array<{
    title: string | null;
    company: string | null;
    starts_at: { year: number; month: number; day: number } | null;
    ends_at: { year: number; month: number; day: number } | null;
  }> | null;
}

async function searchApolloContacts(params: {
  titles: string[];
  geography: string;
  firmSizeMin: number;
  firmSizeMax: number;
  page: number;
}): Promise<{ contacts: ApolloContact[]; totalEntries: number }> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.warn("[sourcing] APOLLO_API_KEY not set — skipping Apollo search");
    return { contacts: [], totalEntries: 0 };
  }

  const body = {
    api_key: apiKey,
    page: params.page,
    per_page: 25,
    person_titles: params.titles,
    organization_locations: [params.geography],
    organization_num_employees_ranges: [
      `${params.firmSizeMin},${params.firmSizeMax}`,
    ],
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };

  const resp = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(
      `[sourcing] Apollo search failed (${resp.status}): ${text.slice(0, 200)}`,
    );
    return { contacts: [], totalEntries: 0 };
  }

  const data = (await resp.json()) as {
    people?: ApolloContact[];
    pagination?: { total_entries: number };
  };

  return {
    contacts: data.people ?? [],
    totalEntries: data.pagination?.total_entries ?? 0,
  };
}

async function getProxycurlProfile(
  linkedinUrl: string,
): Promise<ProxycurlProfile | null> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return null;

  const encoded = encodeURIComponent(linkedinUrl);
  const resp = await fetch(
    `https://nubela.co/proxycurl/api/v2/linkedin?url=${encoded}&personal_email=include`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn(
      `[sourcing] Proxycurl failed (${resp.status}): ${text.slice(0, 200)}`,
    );
    return null;
  }

  return resp.json() as Promise<ProxycurlProfile>;
}

function verifyEmailAcrossSources(
  apolloEmail: string | null,
  apolloEmailStatus: string | null,
  proxycurlEmail: string | null,
): { email: string | null; status: EmailVerificationStatus; sources: string[] } {
  const isValidFormat = (e: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

  const sources: string[] = [];
  let email: string | null = null;
  let status: EmailVerificationStatus = "unverified";

  if (apolloEmail && isValidFormat(apolloEmail)) {
    email = apolloEmail;
    sources.push("apollo");
    if (apolloEmailStatus === "verified") {
      status = "verified";
    } else if (apolloEmailStatus === "likely to engage") {
      status = "risky";
    } else if (apolloEmailStatus === "invalid" || apolloEmailStatus === "bounced") {
      status = "invalid";
    } else {
      status = "unverified";
    }
  }

  if (proxycurlEmail && isValidFormat(proxycurlEmail)) {
    if (!email) email = proxycurlEmail;
    sources.push("proxycurl");
    if (
      apolloEmail &&
      proxycurlEmail.toLowerCase() === apolloEmail.toLowerCase()
    ) {
      // Both sources agree — upgrade to verified
      status = "verified";
    } else if (status === "unverified") {
      // Proxycurl-only: treat as risky without Apollo confirmation
      status = "risky";
    }
  }

  return { email, status, sources };
}

function titlesForVertical(vertical: string): string[] {
  const map: Record<string, string[]> = {
    legal: [
      "Managing Partner",
      "Partner",
      "Attorney",
      "Counsel",
      "Legal Counsel",
    ],
    accounting: [
      "Managing Partner",
      "Partner",
      "CPA",
      "Controller",
      "CFO",
      "Accounting Manager",
    ],
    it_msp: [
      "CEO",
      "President",
      "IT Director",
      "Owner",
      "Founder",
      "Managing Director",
    ],
    marketing_agency: [
      "CEO",
      "Founder",
      "Owner",
      "President",
      "Creative Director",
    ],
    hr_consulting: [
      "CEO",
      "Founder",
      "Managing Director",
      "HR Director",
      "Principal Consultant",
    ],
  };
  return map[vertical] ?? ["CEO", "Founder", "Owner", "Director"];
}

export async function sourceProspectsForCampaign(
  campaignId: string,
  orgId: string,
  opts: {
    vertical: string;
    geography: string;
    firmSizeMin: number;
    firmSizeMax: number;
  },
): Promise<{ sourced: number; enriched: number; errors: string[] }> {
  const db = buildDb();
  const errors: string[] = [];
  let sourced = 0;
  let enriched = 0;

  const titles = titlesForVertical(opts.vertical);

  const { contacts } = await searchApolloContacts({
    titles,
    geography: opts.geography,
    firmSizeMin: opts.firmSizeMin,
    firmSizeMax: opts.firmSizeMax,
    page: 1,
  });

  for (const contact of contacts) {
    try {
      let proxycurl: ProxycurlProfile | null = null;
      if (contact.linkedin_url) {
        proxycurl = await getProxycurlProfile(contact.linkedin_url);
        if (proxycurl) enriched++;
      }

      const { email, status, sources } = verifyEmailAcrossSources(
        contact.email,
        contact.email_status,
        proxycurl?.email ?? null,
      );

      const org = contact.organization;
      const company = org?.name ?? contact.organization_name ?? "";
      if (!company) continue;

      const domain = org?.primary_domain ?? null;
      const employeeCount = org?.estimated_num_employees ?? null;
      const revenueEstimate = org?.annual_revenue_printed ?? null;
      const locationParts = [contact.city, contact.state, contact.country].filter(
        Boolean,
      );
      const location = locationParts.join(", ");

      const enrichmentData: Record<string, unknown> = {};
      if (proxycurl) {
        enrichmentData.proxycurl = {
          headline: proxycurl.headline,
          occupation: proxycurl.occupation,
          experiences: (proxycurl.experiences ?? []).slice(0, 3),
        };
      }

      await db.execute(
        `INSERT INTO sdr_prospects
           (org_id, campaign_id, full_name, email,
            email_verified, email_verification_status, email_verification_sources,
            title, company, company_domain, linkedin_url, location,
            employee_count, revenue_estimate, source,
            apollo_contact_id, proxycurl_profile_id,
            enrichment_data, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18::jsonb, now())
         ON CONFLICT (org_id, apollo_contact_id)
           WHERE apollo_contact_id IS NOT NULL
         DO UPDATE SET
           email = EXCLUDED.email,
           email_verified = EXCLUDED.email_verified,
           email_verification_status = EXCLUDED.email_verification_status,
           email_verification_sources = EXCLUDED.email_verification_sources,
           enrichment_data = EXCLUDED.enrichment_data,
           last_enriched_at = now(),
           updated_at = now()`,
        orgId,
        campaignId,
        contact.name ??
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
        email,
        status === "verified",
        status,
        JSON.stringify(sources),
        contact.title ?? "",
        company,
        domain,
        contact.linkedin_url,
        location,
        employeeCount,
        revenueEstimate,
        proxycurl ? "both" : "apollo",
        contact.id,
        null,
        JSON.stringify(enrichmentData),
      );

      // Fetch and rank trigger events for the company
      const rawTriggers = await fetchTriggerEventsForCompany(company, domain);
      if (rawTriggers.length > 0) {
        const prospectRows = await db.query<{ id: string }>(
          `SELECT id FROM sdr_prospects WHERE org_id = $1 AND apollo_contact_id = $2`,
          orgId,
          contact.id,
        );
        if (prospectRows[0]) {
          const prospectId = prospectRows[0].id;
          const ranked = rankTriggerEvents(
            rawTriggers.map((t) => ({
              id: "",
              prospectId,
              eventType: t.eventType,
              eventTitle: t.title,
              eventDescription: t.description,
              eventDate: t.date,
              sourceUrl: t.sourceUrl,
            })),
          );

          await db.execute(
            `UPDATE sdr_prospect_trigger_events SET is_top_trigger = false WHERE prospect_id = $1`,
            prospectId,
          );

          for (const evt of ranked) {
            await db.execute(
              `INSERT INTO sdr_prospect_trigger_events
                 (org_id, prospect_id, event_type, event_title, event_description,
                  event_date, relevance_score, source_url, is_top_trigger)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              orgId,
              prospectId,
              evt.eventType,
              evt.eventTitle,
              evt.eventDescription ?? null,
              evt.eventDate ?? null,
              evt.relevanceScore,
              evt.sourceUrl ?? null,
              evt.isTopTrigger,
            );
          }
        }
      }

      sourced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Contact ${contact.id}: ${message}`);
      console.error(`[sourcing] Error processing contact ${contact.id}: ${message}`);
    }
  }

  return { sourced, enriched, errors };
}
