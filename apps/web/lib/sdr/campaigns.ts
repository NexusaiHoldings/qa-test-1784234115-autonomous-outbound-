/**
 * SDR campaign server actions and queries.
 * Functions with "use server" inline directives are callable from client
 * components as server actions.
 */

import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  vertical: string;
  geography: string;
  firm_size_min: number;
  firm_size_max: number;
  revenue_band: string;
  sending_window_days: string[];
  sending_window_start: string;
  sending_window_end: string;
  tone: string;
  template_key: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignInput {
  name: string;
  vertical: string;
  geography: string;
  firmSizeMin: number;
  firmSizeMax: number;
  revenueBand: string;
  sendingWindowDays: string[];
  sendingWindowStart: string;
  sendingWindowEnd: string;
  tone: string;
  templateKey: string;
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

export async function listCampaigns(): Promise<Campaign[]> {
  const orgId = await resolveOrgId();
  if (!orgId) return [];
  const db = buildDb();
  const rows = await db.query<Campaign>(
    `SELECT id, org_id, name, vertical, geography,
            firm_size_min, firm_size_max, revenue_band,
            sending_window_days, sending_window_start, sending_window_end,
            tone, template_key, status,
            created_at::text, updated_at::text
     FROM sdr_campaigns
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    orgId,
  );
  return rows.map((r) => ({
    ...r,
    sending_window_days: Array.isArray(r.sending_window_days)
      ? (r.sending_window_days as string[])
      : (JSON.parse(r.sending_window_days as unknown as string) as string[]),
  }));
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<{ ok: true; campaign: Campaign } | { ok: false; error: string }> {
  "use server";
  const orgId = await resolveOrgId();
  if (!orgId) {
    return { ok: false, error: "Not authenticated" };
  }
  if (!input.name.trim()) {
    return { ok: false, error: "Campaign name is required" };
  }
  if (!input.vertical) {
    return { ok: false, error: "Vertical is required" };
  }
  const db = buildDb();
  try {
    const rows = await db.query<Campaign>(
      `INSERT INTO sdr_campaigns
         (org_id, name, vertical, geography,
          firm_size_min, firm_size_max, revenue_band,
          sending_window_days, sending_window_start, sending_window_end,
          tone, template_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, 'draft')
       RETURNING id, org_id, name, vertical, geography,
                 firm_size_min, firm_size_max, revenue_band,
                 sending_window_days, sending_window_start, sending_window_end,
                 tone, template_key, status,
                 created_at::text, updated_at::text`,
      orgId,
      input.name.trim(),
      input.vertical,
      input.geography,
      input.firmSizeMin,
      input.firmSizeMax,
      input.revenueBand,
      JSON.stringify(input.sendingWindowDays),
      input.sendingWindowStart,
      input.sendingWindowEnd,
      input.tone,
      input.templateKey,
    );
    if (!rows[0]) {
      return { ok: false, error: "Insert failed" };
    }
    const campaign = {
      ...rows[0],
      sending_window_days: Array.isArray(rows[0].sending_window_days)
        ? (rows[0].sending_window_days as string[])
        : (JSON.parse(rows[0].sending_window_days as unknown as string) as string[]),
    };
    return { ok: true, campaign };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { ok: false, error: message };
  }
}
