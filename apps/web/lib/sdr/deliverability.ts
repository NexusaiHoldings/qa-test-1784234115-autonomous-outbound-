/**
 * Operator-only deliverability data access.
 * All functions here are server-side only and require admin authorization
 * at the call site (page or API route) before invocation.
 */

import { buildDb } from "@/lib/db";

export interface SendingDomain {
  id: string;
  org_id: string;
  domain: string;
  status: string;
  warmup_stage: number;
  warmup_target_daily: number;
  daily_send_count: number;
  bounce_rate: number;
  spam_complaint_rate: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantSendCap {
  id: string;
  org_id: string;
  daily_cap: number;
  weekly_cap: number;
  daily_sent: number;
  weekly_sent: number;
  cap_override_reason: string | null;
  updated_at: string;
}

export interface ProviderHealth {
  id: string;
  provider: string;
  rate_limit_total: number;
  rate_limit_remaining: number;
  rate_limit_reset_at: string | null;
  status: string;
  last_error: string | null;
  checked_at: string;
}

export interface DomainAnomaly {
  id: string;
  org_id: string | null;
  domain: string | null;
  anomaly_type: string;
  severity: string;
  message: string;
  resolved_at: string | null;
  created_at: string;
}

export interface CampaignKillStatus {
  id: string;
  org_id: string;
  name: string;
  status: string;
  created_at: string;
}

export interface DeliverabilityOverview {
  sendingDomains: SendingDomain[];
  tenantSendCaps: TenantSendCap[];
  providerHealth: ProviderHealth[];
  activeAnomalies: DomainAnomaly[];
  campaigns: CampaignKillStatus[];
}

export async function getSendingDomains(): Promise<SendingDomain[]> {
  const db = buildDb();
  return db.query<SendingDomain>(
    `SELECT id, org_id, domain, status, warmup_stage, warmup_target_daily,
            daily_send_count,
            bounce_rate::float AS bounce_rate,
            spam_complaint_rate::float AS spam_complaint_rate,
            last_checked_at::text,
            created_at::text, updated_at::text
     FROM sdr_sending_domains
     ORDER BY org_id, domain`,
  );
}

export async function getTenantSendCaps(): Promise<TenantSendCap[]> {
  const db = buildDb();
  return db.query<TenantSendCap>(
    `SELECT id, org_id, daily_cap, weekly_cap, daily_sent, weekly_sent,
            cap_override_reason, updated_at::text
     FROM sdr_tenant_send_caps
     ORDER BY org_id`,
  );
}

export async function getProviderHealth(): Promise<ProviderHealth[]> {
  const db = buildDb();
  const rows = await db.query<ProviderHealth>(
    `SELECT id, provider, rate_limit_total, rate_limit_remaining,
            rate_limit_reset_at::text,
            status, last_error, checked_at::text
     FROM sdr_provider_health
     ORDER BY provider`,
  );
  // Seed default rows for known providers when table is empty so the UI
  // always has something meaningful to show.
  if (rows.length === 0) {
    return [
      {
        id: "00000000-0000-0000-0000-000000000001",
        provider: "apollo",
        rate_limit_total: 0,
        rate_limit_remaining: 0,
        rate_limit_reset_at: null,
        status: "unknown",
        last_error: null,
        checked_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000002",
        provider: "proxycurl",
        rate_limit_total: 0,
        rate_limit_remaining: 0,
        rate_limit_reset_at: null,
        status: "unknown",
        last_error: null,
        checked_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000003",
        provider: "sendgrid",
        rate_limit_total: 0,
        rate_limit_remaining: 0,
        rate_limit_reset_at: null,
        status: "unknown",
        last_error: null,
        checked_at: new Date().toISOString(),
      },
    ];
  }
  return rows;
}

export async function getActiveAnomalies(): Promise<DomainAnomaly[]> {
  const db = buildDb();
  return db.query<DomainAnomaly>(
    `SELECT id, org_id, domain, anomaly_type, severity, message,
            resolved_at::text, created_at::text
     FROM sdr_domain_anomalies
     WHERE resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT 50`,
  );
}

export async function getAllCampaigns(): Promise<CampaignKillStatus[]> {
  const db = buildDb();
  return db.query<CampaignKillStatus>(
    `SELECT id, org_id, name, status, created_at::text
     FROM sdr_campaigns
     ORDER BY created_at DESC
     LIMIT 200`,
  );
}

export async function getDeliverabilityOverview(): Promise<DeliverabilityOverview> {
  const [sendingDomains, tenantSendCaps, providerHealth, activeAnomalies, campaigns] =
    await Promise.all([
      getSendingDomains(),
      getTenantSendCaps(),
      getProviderHealth(),
      getActiveAnomalies(),
      getAllCampaigns(),
    ]);
  return { sendingDomains, tenantSendCaps, providerHealth, activeAnomalies, campaigns };
}

export async function killCampaign(campaignId: string): Promise<void> {
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_campaigns SET status = 'killed', updated_at = now() WHERE id = $1`,
    campaignId,
  );
}

export async function reviveCampaign(campaignId: string): Promise<void> {
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_campaigns SET status = 'active', updated_at = now() WHERE id = $1`,
    campaignId,
  );
}

export async function resolveAnomaly(anomalyId: string): Promise<void> {
  const db = buildDb();
  await db.execute(
    `UPDATE sdr_domain_anomalies SET resolved_at = now() WHERE id = $1`,
    anomalyId,
  );
}
