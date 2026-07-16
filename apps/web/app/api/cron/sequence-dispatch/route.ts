/**
 * GET /api/cron/sequence-dispatch — Vercel cron that runs the 3-touch
 * cadence dispatcher for every active SDR campaign.
 *
 * Steps per run:
 *  1. Enqueue sequences for any newly-eligible prospects (verified email,
 *     no existing sequence, not suppressed).
 *  2. Dispatch touches that are now due, subject to per-tenant daily caps.
 *
 * Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
 * is set; the route is unguarded in local/dev (no env var present).
 */

import { NextResponse } from "next/server";
import { buildDb } from "@/lib/db";
import {
  enqueueSequencesForCampaign,
  dispatchQueuedTouches,
} from "@/lib/sdr/sequencer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface ActiveCampaign {
  id: string;
  org_id: string;
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
  const dailyCap = parseInt(
    process.env.SENDGRID_DAILY_CAP ?? "50",
    10,
  );

  let campaigns: ActiveCampaign[];
  try {
    campaigns = await db.query<ActiveCampaign>(
      `SELECT id, org_id
       FROM sdr_campaigns
       WHERE status = 'active'
       ORDER BY created_at ASC`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sequence-dispatch] Failed to fetch campaigns: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (campaigns.length === 0) {
    return NextResponse.json({
      ok: true,
      campaigns: 0,
      sequencesCreated: 0,
      touchesQueued: 0,
      touchesSent: 0,
      suppressed: 0,
      errors: [],
    });
  }

  let totalSequencesCreated = 0;
  let totalTouchesQueued = 0;
  let totalTouchesSent = 0;
  let totalSuppressed = 0;
  const allErrors: string[] = [];

  // Collect distinct orgs to apply per-tenant daily caps across campaigns
  const orgsProcessed = new Set<string>();

  for (const campaign of campaigns) {
    try {
      const enqueueResult = await enqueueSequencesForCampaign(
        campaign.id,
        campaign.org_id,
      );
      totalSequencesCreated += enqueueResult.sequencesCreated;
      totalTouchesQueued += enqueueResult.touchesQueued;
      totalSuppressed += enqueueResult.suppressed;
      allErrors.push(
        ...enqueueResult.errors.map(
          (e) => `[campaign:${campaign.id}] enqueue: ${e}`,
        ),
      );
      console.log(
        `[sequence-dispatch] campaign=${campaign.id} enqueued sequences=${enqueueResult.sequencesCreated} touches=${enqueueResult.touchesQueued} suppressed=${enqueueResult.suppressed}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      allErrors.push(`[campaign:${campaign.id}] enqueue: ${message}`);
      console.error(
        `[sequence-dispatch] campaign=${campaign.id} enqueue failed: ${message}`,
      );
    }

    orgsProcessed.add(campaign.org_id);
  }

  // Dispatch due touches once per org (respects per-tenant daily cap)
  for (const orgId of orgsProcessed) {
    try {
      const dispatchResult = await dispatchQueuedTouches(orgId, dailyCap);
      totalTouchesSent += dispatchResult.sent;
      allErrors.push(
        ...dispatchResult.errors.map((e) => `[org:${orgId}] dispatch: ${e}`),
      );
      console.log(
        `[sequence-dispatch] org=${orgId} dispatched=${dispatchResult.sent} errors=${dispatchResult.errors.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      allErrors.push(`[org:${orgId}] dispatch: ${message}`);
      console.error(
        `[sequence-dispatch] org=${orgId} dispatch failed: ${message}`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    campaigns: campaigns.length,
    sequencesCreated: totalSequencesCreated,
    touchesQueued: totalTouchesQueued,
    touchesSent: totalTouchesSent,
    suppressed: totalSuppressed,
    errors: allErrors.slice(0, 50),
  });
}
