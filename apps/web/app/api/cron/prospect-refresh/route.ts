/**
 * GET /api/cron/prospect-refresh — daily Vercel cron that runs the
 * prospect sourcing + enrichment pipeline for every active SDR campaign.
 *
 * Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
 * is set; the route is unguarded in local/dev (no env var).
 */

import { NextResponse } from "next/server";
import { buildDb } from "@/lib/db";
import { sourceProspectsForCampaign } from "@/lib/sdr/sourcing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface ActiveCampaign {
  id: string;
  org_id: string;
  vertical: string;
  geography: string;
  firm_size_min: number;
  firm_size_max: number;
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const db = buildDb();

  let campaigns: ActiveCampaign[];
  try {
    campaigns = await db.query<ActiveCampaign>(
      `SELECT id, org_id, vertical, geography, firm_size_min, firm_size_max
       FROM sdr_campaigns
       WHERE status = 'active'
       ORDER BY created_at ASC`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[prospect-refresh] Failed to fetch campaigns: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (campaigns.length === 0) {
    return NextResponse.json({ ok: true, campaigns: 0, sourced: 0, enriched: 0, errors: [] });
  }

  let totalSourced = 0;
  let totalEnriched = 0;
  const allErrors: string[] = [];

  for (const campaign of campaigns) {
    try {
      const result = await sourceProspectsForCampaign(
        campaign.id,
        campaign.org_id,
        {
          vertical: campaign.vertical,
          geography: campaign.geography,
          firmSizeMin: campaign.firm_size_min,
          firmSizeMax: campaign.firm_size_max,
        },
      );
      totalSourced += result.sourced;
      totalEnriched += result.enriched;
      allErrors.push(
        ...result.errors.map((e) => `[campaign:${campaign.id}] ${e}`),
      );
      console.log(
        `[prospect-refresh] campaign=${campaign.id} sourced=${result.sourced} enriched=${result.enriched} errors=${result.errors.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      allErrors.push(`[campaign:${campaign.id}] ${message}`);
      console.error(
        `[prospect-refresh] campaign=${campaign.id} failed: ${message}`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    campaigns: campaigns.length,
    sourced: totalSourced,
    enriched: totalEnriched,
    errors: allErrors.slice(0, 50),
  });
}
