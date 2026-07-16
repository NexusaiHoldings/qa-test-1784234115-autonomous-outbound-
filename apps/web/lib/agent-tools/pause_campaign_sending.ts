/**
 * Agent tool handler: pause_campaign_sending
 *
 * Confirm-gated mutation. Sets a campaign's sequence dispatch to paused in
 * sdr_campaigns when reputation thresholds are breached. Called by the
 * sentinel on anomaly detection.
 *
 * Autonomy = confirm — mutations route through the cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

interface Args {
  campaign_id: string;
  org_id: string;
  reason: string;
  bounce_rate?: number;
  spam_rate?: number;
  unsubscribe_rate?: number;
}

interface CampaignRow {
  id: string;
  org_id: string;
  status: string;
  name: string;
  dispatch_paused: boolean;
}

export async function handlePauseCampaignSending(
  ctx: HandlerContext,
  args: Record<string, unknown>
): Promise<HandlerResult> {
  const {
    campaign_id,
    org_id,
    reason,
    bounce_rate,
    spam_rate,
    unsubscribe_rate,
  } = args as unknown as Args;

  if (!campaign_id || typeof campaign_id !== "string") {
    return { status: 400, body: "campaign_id is required" };
  }
  if (!org_id || typeof org_id !== "string") {
    return { status: 400, body: "org_id is required" };
  }
  if (!reason || typeof reason !== "string") {
    return { status: 400, body: "reason is required" };
  }
  if (bounce_rate !== undefined && (typeof bounce_rate !== "number" || bounce_rate < 0 || bounce_rate > 1)) {
    return { status: 400, body: "bounce_rate must be a number between 0 and 1" };
  }
  if (spam_rate !== undefined && (typeof spam_rate !== "number" || spam_rate < 0 || spam_rate > 1)) {
    return { status: 400, body: "spam_rate must be a number between 0 and 1" };
  }
  if (unsubscribe_rate !== undefined && (typeof unsubscribe_rate !== "number" || unsubscribe_rate < 0 || unsubscribe_rate > 1)) {
    return { status: 400, body: "unsubscribe_rate must be a number between 0 and 1" };
  }

  // Verify the campaign exists and belongs to this org
  const campaignRows = await ctx.db.query<CampaignRow>(
    `SELECT id, org_id, status, name, dispatch_paused
       FROM sdr_campaigns
      WHERE id = $1 AND org_id = $2`,
    campaign_id,
    org_id
  );
  const campaign = campaignRows[0];
  if (!campaign) {
    return { status: 404, body: "Campaign not found for this org" };
  }

  // Idempotent — if already paused, return success without re-writing
  if (campaign.dispatch_paused) {
    return {
      status: 200,
      body: {
        campaign_id,
        org_id,
        campaign_name: campaign.name,
        dispatch_paused: true,
        already_paused: true,
        message: `Campaign "${campaign.name}" sending is already paused`,
      },
    };
  }

  // Pause dispatch and record the sentinel-reported metrics
  await ctx.db.execute(
    `UPDATE sdr_campaigns
        SET dispatch_paused = TRUE,
            dispatch_paused_at = NOW(),
            dispatch_paused_reason = $3,
            dispatch_paused_bounce_rate = $4,
            dispatch_paused_spam_rate = $5,
            dispatch_paused_unsubscribe_rate = $6,
            updated_at = NOW()
      WHERE id = $1 AND org_id = $2`,
    campaign_id,
    org_id,
    reason,
    bounce_rate ?? null,
    spam_rate ?? null,
    unsubscribe_rate ?? null
  );

  // Cancel any pending touches for this campaign to prevent dispatch during the pause
  const cancelResult = await ctx.db.query<{ count: string }>(
    `UPDATE sdr_sequence_touches
        SET status = 'paused', updated_at = NOW()
      WHERE campaign_id = $1
        AND org_id = $2
        AND status IN ('pending', 'scheduled')
      RETURNING id`,
    campaign_id,
    org_id
  );
  const pausedTouchCount = cancelResult.length;

  return {
    status: 200,
    body: {
      campaign_id,
      org_id,
      campaign_name: campaign.name,
      dispatch_paused: true,
      already_paused: false,
      paused_touches: pausedTouchCount,
      reason,
      ...(bounce_rate !== undefined && { bounce_rate }),
      ...(spam_rate !== undefined && { spam_rate }),
      ...(unsubscribe_rate !== undefined && { unsubscribe_rate }),
      message: `Campaign "${campaign.name}" sending paused due to reputation threshold breach: ${reason}`,
    },
  };
}
