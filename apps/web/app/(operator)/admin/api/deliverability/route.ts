/**
 * Operator-only deliverability API.
 * GET  /admin/api/deliverability  — full overview (domains, caps, providers, anomalies, campaigns)
 * POST /admin/api/deliverability  — campaign kill/revive action or resolve anomaly
 *
 * getAdminUser() is called before any body parse or DB access; returns 403
 * immediately for non-admin sessions.
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin-auth";
import {
  getDeliverabilityOverview,
  killCampaign,
  reviveCampaign,
  resolveAnomaly,
} from "@/lib/sdr/deliverability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const overview = await getDeliverabilityOverview();
    return NextResponse.json(overview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error({ event: "deliverability_overview_error", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as string | undefined;
  const campaignId = body.campaign_id as string | undefined;
  const anomalyId = body.anomaly_id as string | undefined;

  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    if (action === "kill_campaign") {
      if (!campaignId) {
        return NextResponse.json({ error: "Missing campaign_id" }, { status: 400 });
      }
      await killCampaign(campaignId);
      console.info({
        event: "campaign_killed",
        campaign_id: campaignId,
        admin_email: admin.email,
      });
      return NextResponse.json({ ok: true, action: "killed", campaign_id: campaignId });
    }

    if (action === "revive_campaign") {
      if (!campaignId) {
        return NextResponse.json({ error: "Missing campaign_id" }, { status: 400 });
      }
      await reviveCampaign(campaignId);
      console.info({
        event: "campaign_revived",
        campaign_id: campaignId,
        admin_email: admin.email,
      });
      return NextResponse.json({ ok: true, action: "revived", campaign_id: campaignId });
    }

    if (action === "resolve_anomaly") {
      if (!anomalyId) {
        return NextResponse.json({ error: "Missing anomaly_id" }, { status: 400 });
      }
      await resolveAnomaly(anomalyId);
      console.info({
        event: "anomaly_resolved",
        anomaly_id: anomalyId,
        admin_email: admin.email,
      });
      return NextResponse.json({ ok: true, action: "resolved", anomaly_id: anomalyId });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error({ event: "deliverability_action_error", action, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
