import type { JSX, CSSProperties } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ProspectRow {
  id: string;
  full_name: string;
  email: string | null;
  email_verification_status: string;
  email_verification_sources: string[] | string;
  title: string | null;
  company: string;
  company_domain: string | null;
  linkedin_url: string | null;
  location: string | null;
  source: string;
  campaign_id: string;
  campaign_name: string | null;
  top_trigger_type: string | null;
  top_trigger_title: string | null;
  last_enriched_at: string | null;
  created_at: string;
}

interface CampaignOption {
  id: string;
  name: string;
}

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

async function listProspects(
  orgId: string,
  filters: {
    search?: string;
    campaign?: string;
    verification?: string;
    triggerType?: string;
  },
): Promise<ProspectRow[]> {
  const db = buildDb();
  const conditions: string[] = ["p.org_id = $1"];
  const params: unknown[] = [orgId];
  let paramIdx = 2;

  if (filters.campaign) {
    conditions.push(`p.campaign_id = $${paramIdx}`);
    params.push(filters.campaign);
    paramIdx++;
  }
  if (filters.verification) {
    conditions.push(`p.email_verification_status = $${paramIdx}`);
    params.push(filters.verification);
    paramIdx++;
  }
  if (filters.triggerType) {
    conditions.push(
      `EXISTS (SELECT 1 FROM sdr_prospect_trigger_events t WHERE t.prospect_id = p.id AND t.is_top_trigger = true AND t.event_type = $${paramIdx})`,
    );
    params.push(filters.triggerType);
    paramIdx++;
  }
  if (filters.search) {
    const term = `%${filters.search.toLowerCase()}%`;
    conditions.push(
      `(lower(p.full_name) LIKE $${paramIdx} OR lower(p.company) LIKE $${paramIdx} OR lower(p.email) LIKE $${paramIdx})`,
    );
    params.push(term);
    paramIdx++;
  }

  const where = conditions.join(" AND ");
  const rows = await db.query<ProspectRow>(
    `SELECT
       p.id, p.full_name, p.email,
       p.email_verification_status,
       p.email_verification_sources,
       p.title, p.company, p.company_domain,
       p.linkedin_url, p.location, p.source,
       p.campaign_id,
       c.name AS campaign_name,
       t.event_type AS top_trigger_type,
       t.event_title AS top_trigger_title,
       p.last_enriched_at::text,
       p.created_at::text
     FROM sdr_prospects p
     LEFT JOIN sdr_campaigns c ON c.id = p.campaign_id
     LEFT JOIN sdr_prospect_trigger_events t
       ON t.prospect_id = p.id AND t.is_top_trigger = true
     WHERE ${where}
     ORDER BY p.created_at DESC
     LIMIT 200`,
    ...params,
  );

  return rows.map((r) => ({
    ...r,
    email_verification_sources: Array.isArray(r.email_verification_sources)
      ? (r.email_verification_sources as string[])
      : JSON.parse((r.email_verification_sources as string) || "[]"),
  }));
}

async function getCampaignOptions(orgId: string): Promise<CampaignOption[]> {
  const db = buildDb();
  return db.query<CampaignOption>(
    `SELECT id, name FROM sdr_campaigns WHERE org_id = $1 ORDER BY name`,
    orgId,
  );
}

const VERIFICATION_COLORS: Record<string, string> = {
  verified: "#16a34a",
  risky: "#d97706",
  invalid: "#dc2626",
  unverified: "#6b7280",
};

const TRIGGER_COLORS: Record<string, string> = {
  funding: "#7c3aed",
  leadership_hire: "#0369a1",
  product_launch: "#0f766e",
  expansion: "#b45309",
  job_posting: "#4b5563",
};

const SOURCE_LABELS: Record<string, string> = {
  apollo: "Apollo",
  proxycurl: "LinkedIn",
  both: "Apollo + LinkedIn",
};

const TRIGGER_LABELS: Record<string, string> = {
  funding: "Funding",
  leadership_hire: "Leadership Hire",
  product_launch: "Product Launch",
  expansion: "Expansion",
  job_posting: "Hiring",
};

function VerificationBadge({ status }: { status: string }): JSX.Element {
  const color = VERIFICATION_COLORS[status] ?? "#6b7280";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        textTransform: "capitalize",
      }}
    >
      {label}
    </span>
  );
}

function SourceChip({ source }: { source: string }): JSX.Element {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 500,
        background: "#f3f4f6",
        color: "#374151",
        border: "1px solid #e5e7eb",
        marginRight: 4,
      }}
    >
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function TriggerPill({
  triggerType,
  triggerTitle,
}: {
  triggerType: string;
  triggerTitle: string;
}): JSX.Element {
  const color = TRIGGER_COLORS[triggerType] ?? "#4b5563";
  const label = TRIGGER_LABELS[triggerType] ?? triggerType;
  return (
    <span
      title={triggerTitle}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: `${color}15`,
        color,
        border: `1px solid ${color}35`,
        maxWidth: 180,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SkeletonRow(): JSX.Element {
  const shimmer: CSSProperties = {
    background: "linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)",
    backgroundSize: "200% 100%",
    borderRadius: 4,
    height: 14,
    display: "inline-block",
  };
  return (
    <tr>
      <td><span style={{ ...shimmer, width: 120 }} /></td>
      <td><span style={{ ...shimmer, width: 90 }} /></td>
      <td><span style={{ ...shimmer, width: 150 }} /></td>
      <td><span style={{ ...shimmer, width: 70 }} /></td>
      <td><span style={{ ...shimmer, width: 80 }} /></td>
      <td><span style={{ ...shimmer, width: 100 }} /></td>
      <td><span style={{ ...shimmer, width: 60 }} /></td>
    </tr>
  );
}

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: {
    search?: string;
    campaign?: string;
    verification?: string;
    triggerType?: string;
  };
}): Promise<JSX.Element> {
  const orgId = await resolveOrgId();

  if (!orgId) {
    return (
      <main>
        <h1>Prospects</h1>
        <p>Sign in to view your sourced prospects.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const [prospects, campaigns] = await Promise.all([
    listProspects(orgId, searchParams),
    getCampaignOptions(orgId),
  ]);

  const currentSearch = searchParams.search ?? "";
  const currentCampaign = searchParams.campaign ?? "";
  const currentVerification = searchParams.verification ?? "";
  const currentTrigger = searchParams.triggerType ?? "";

  return (
    <main>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <h1>Prospects</h1>
          <p>
            AI-sourced contacts from Apollo and LinkedIn, enriched with trigger
            events and cross-verified email addresses.
          </p>
        </div>
        <Link href="/campaigns/new" className="btn secondary">
          New Campaign
        </Link>
      </div>

      <form method="GET" action="/prospects" className="toolbar">
        <input
          type="search"
          name="search"
          defaultValue={currentSearch}
          placeholder="Search name, company, email…"
          style={{ minWidth: 200 }}
        />
        <select name="campaign" defaultValue={currentCampaign}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="verification" defaultValue={currentVerification}>
          <option value="">All verification</option>
          <option value="verified">Verified</option>
          <option value="risky">Risky</option>
          <option value="unverified">Unverified</option>
          <option value="invalid">Invalid</option>
        </select>
        <select name="triggerType" defaultValue={currentTrigger}>
          <option value="">All triggers</option>
          <option value="funding">Funding</option>
          <option value="leadership_hire">Leadership Hire</option>
          <option value="product_launch">Product Launch</option>
          <option value="expansion">Expansion</option>
          <option value="job_posting">Hiring</option>
        </select>
        <button type="submit">Search</button>
        {(currentSearch || currentCampaign || currentVerification || currentTrigger) && (
          <a href="/prospects" className="btn secondary">
            Clear
          </a>
        )}
      </form>

      {prospects.length === 0 ? (
        <div className="empty" style={{ marginTop: "2rem" }}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🎯</div>
            <h2 style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
              No prospects yet
            </h2>
            <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem" }}>
              Prospects are sourced automatically each day from Apollo and
              LinkedIn. Activate a campaign to start pulling contacts, or check
              back after the next daily refresh.
            </p>
            <Link href="/campaigns" className="btn">
              Go to Campaigns
            </Link>
          </div>
          {/* Loading skeleton — shown as preview while first refresh is in progress */}
          <table style={{ width: "100%", opacity: 0.4, pointerEvents: "none" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Name</th>
                <th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Verification</th>
                <th style={{ textAlign: "left" }}>Source</th>
                <th style={{ textAlign: "left" }}>Top Trigger</th>
                <th style={{ textAlign: "left" }}>Campaign</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
            {prospects.length} prospect{prospects.length !== 1 ? "s" : ""}
          </p>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Name</th>
                <th style={{ textAlign: "left" }}>Company</th>
                <th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Verification</th>
                <th style={{ textAlign: "left" }}>Source</th>
                <th style={{ textAlign: "left" }}>Top Trigger</th>
                <th style={{ textAlign: "left" }}>Campaign</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.full_name}</div>
                    {p.title && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.title}
                      </div>
                    )}
                  </td>
                  <td>
                    <div>{p.company}</div>
                    {p.location && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {p.location}
                      </div>
                    )}
                  </td>
                  <td>
                    {p.email ? (
                      <span style={{ fontSize: 13 }}>{p.email}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <VerificationBadge status={p.email_verification_status} />
                    {Array.isArray(p.email_verification_sources) &&
                      p.email_verification_sources.length > 1 && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {(p.email_verification_sources as string[]).join(" + ")}
                        </div>
                      )}
                  </td>
                  <td>
                    <SourceChip source={p.source} />
                  </td>
                  <td>
                    {p.top_trigger_type && p.top_trigger_title ? (
                      <TriggerPill
                        triggerType={p.top_trigger_type}
                        triggerTitle={p.top_trigger_title}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {p.campaign_name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
