"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export interface Suppression {
  id: string;
  org_id: string;
  email: string;
  reason: string;
  notes: string | null;
  created_at: string;
}

export type SuppressionReason = "unsubscribed" | "manual" | "bounced";

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

export async function listSuppressions(): Promise<Suppression[]> {
  const orgId = await resolveOrgId();
  if (!orgId) return [];
  const db = buildDb();
  const rows = await db.query<Suppression>(
    `SELECT id, org_id, email, reason, notes, created_at::text
     FROM sdr_suppressions
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    orgId,
  );
  return rows;
}

export async function addSuppressionAction(formData: FormData): Promise<void> {
  const orgId = await resolveOrgId();
  if (!orgId) {
    redirect("/login");
  }
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  const reason = (formData.get("reason") as string | null) ?? "manual";
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  if (!email || !email.includes("@")) {
    revalidatePath("/suppressions");
    return;
  }
  const db = buildDb();
  await db.execute(
    `INSERT INTO sdr_suppressions (org_id, email, reason, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, email) DO UPDATE
       SET reason = EXCLUDED.reason,
           notes = EXCLUDED.notes`,
    orgId,
    email,
    reason,
    notes,
  );
  revalidatePath("/suppressions");
  redirect("/suppressions");
}

export async function removeSuppressionAction(formData: FormData): Promise<void> {
  const orgId = await resolveOrgId();
  if (!orgId) {
    redirect("/login");
  }
  const email = (formData.get("email") as string | null)?.trim().toLowerCase() ?? "";
  if (!email) {
    revalidatePath("/suppressions");
    return;
  }
  const db = buildDb();
  await db.execute(
    `DELETE FROM sdr_suppressions WHERE org_id = $1 AND email = $2`,
    orgId,
    email,
  );
  revalidatePath("/suppressions");
  redirect("/suppressions");
}

export async function importSuppressionsCsvAction(formData: FormData): Promise<void> {
  const orgId = await resolveOrgId();
  if (!orgId) {
    redirect("/login");
  }
  const csvText = (formData.get("csv") as string | null) ?? "";
  const lines = csvText
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean);
  const dataLines =
    lines.length > 0 && lines[0].toLowerCase().startsWith("email")
      ? lines.slice(1)
      : lines;
  const emails: string[] = [];
  for (const line of dataLines) {
    const parts = line.split(",");
    const candidate = parts[0].trim().replace(/^"|"$/g, "").toLowerCase();
    if (candidate && candidate.includes("@")) {
      emails.push(candidate);
    }
  }
  if (emails.length > 0) {
    const db = buildDb();
    for (const em of emails) {
      await db.execute(
        `INSERT INTO sdr_suppressions (org_id, email, reason)
         VALUES ($1, $2, 'manual')
         ON CONFLICT (org_id, email) DO NOTHING`,
        orgId,
        em,
      );
    }
  }
  revalidatePath("/suppressions");
  redirect("/suppressions");
}

export async function isEmailSuppressed(orgId: string, email: string): Promise<boolean> {
  const db = buildDb();
  const rows = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM sdr_suppressions
     WHERE org_id = $1 AND email = $2`,
    orgId,
    email.trim().toLowerCase(),
  );
  return parseInt(rows[0]?.cnt ?? "0", 10) > 0;
}

export async function upsertSuppression(
  orgId: string,
  email: string,
  reason: string,
): Promise<void> {
  const db = buildDb();
  await db.execute(
    `INSERT INTO sdr_suppressions (org_id, email, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, email) DO UPDATE
       SET reason = EXCLUDED.reason`,
    orgId,
    email.trim().toLowerCase(),
    reason,
  );
}

export function generateUnsubscribeToken(orgId: string, email: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "dev-secret";
  const normalized = email.trim().toLowerCase();
  const payload = JSON.stringify({ org_id: orgId, email: normalized });
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, 32);
  const packed = JSON.stringify({ org_id: orgId, email: normalized, sig });
  return Buffer.from(packed).toString("base64url");
}

export function verifyUnsubscribeToken(
  token: string,
): { org_id: string; email: string } | null {
  try {
    const packed = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(packed) as {
      org_id?: string;
      email?: string;
      sig?: string;
    };
    if (!parsed.org_id || !parsed.email || !parsed.sig) return null;
    const secret = process.env.NEXTAUTH_SECRET ?? "dev-secret";
    const payload = JSON.stringify({
      org_id: parsed.org_id,
      email: parsed.email.toLowerCase(),
    });
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex")
      .slice(0, 32);
    if (parsed.sig !== expectedSig) return null;
    return { org_id: parsed.org_id, email: parsed.email.toLowerCase() };
  } catch {
    return null;
  }
}
