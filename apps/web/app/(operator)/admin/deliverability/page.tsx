/**
 * Operator deliverability console — /admin/deliverability
 *
 * Admin-only. Shows per-sending-domain reputation (bounce rate, spam-complaint
 * rate, warm-up ramp stage), per-tenant send caps, provider health
 * (Apollo/Proxycurl rate-budget consumption), and a campaign kill switch.
 * Non-admins are redirected to /login.
 */

import type { JSX } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/admin-auth";
import {
  getDeliverabilityOverview,
  killCampaign,
  reviveCampaign,
  resolveAnomaly,
  type SendingDomain,
  type TenantSendCap,
  type ProviderHealth,
  type DomainAnomaly,
  type CampaignKillStatus,
} from "@/lib/sdr/deliverability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Server actions ────────────────────────────────────────────────────────────

async function campaignKillAction(formData: FormData): Promise<void> {
  "use server";
  const admin = await getAdminUser();
  if (!admin) return;
  const campaignId = formData.get("campaignId") as string;
  const action = formData.get("action") as string;
  if (!campaignId) return;
  if (action === "kill") {
    await killCampaign(campaignId);
  } else if (action === "revive") {
    await reviveCampaign(campaignId);
  }
  revalidatePath("/admin/deliverability");
}

async function resolveAnomalyAction(formData: FormData): Promise<void> {
  "use server";
  const admin = await getAdminUser();
  if (!admin) return;
  const anomalyId = formData.get("anomalyId") as string;
  if (!anomalyId) return;
  await resolveAnomaly(anomalyId);
  revalidatePath("/admin/deliverability");
}

// ── Sub-components ────────────────────────────────────────────────────────────

type PillVariant = "green" | "yellow" | "red" | "gray";

function pillVariant(status: string): PillVariant {
  if (["healthy", "active"].includes(status)) return "green";
  if (["warming", "degraded"].includes(status)) return "yellow";
  if (["at_risk", "suspended", "killed", "down"].includes(status)) return "red";
  return "gray";
}

function StatusPill({ status }: { status: string }): JSX.Element {
  const variant = pillVariant(status);
  const bgMap: Record<PillVariant, string> = {
    green: "#d1fae5",
    yellow: "#fef3c7",
    red: "#fee2e2",
    gray: "#f3f4f6",
  };
  const colorMap: Record<PillVariant, string> = {
    green: "#065f46",
    yellow: "#92400e",
    red: "#991b1b",
    gray: "#374151",
  };
  const borderMap: Record<PillVariant, string> = {
    green: "1px solid #6ee7b7",
    yellow: "1px solid #fcd34d",
    red: "1px solid #fca5a5",
    gray: "1px solid #d1d5db",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "capitalize",
        background: bgMap[variant],
        color: colorMap[variant],
        border: borderMap[variant],
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function WarmupBar({
  stage,
  dailySent,
  dailyTarget,
}: {
  stage: number;
  dailySent: number;
  dailyTarget: number;
}): JSX.Element {
  const MAX_STAGE = 10;
  const stagePct = Math.min(100, (stage / MAX_STAGE) * 100);
  const dailyPct = dailyTarget > 0 ? Math.min(100, (dailySent / dailyTarget) * 100) : 0;
  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "2px" }}>
        Warm-up stage {stage}/{MAX_STAGE}
      </div>
      <div
        style={{
          background: "#e5e7eb",
          borderRadius: "4px",
          height: "8px",
          overflow: "hidden",
          marginBottom: "6px",
        }}
      >
        <div
          style={{
            background: "#3b82f6",
            width: `${stagePct}%`,
            height: "100%",
            transition: "width 0.3s",
          }}
        />
      </div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "2px" }}>
        Today: {dailySent} / {dailyTarget} sends ({Math.round(dailyPct)}%)
      </div>
      <div
        style={{
          background: "#e5e7eb",
          borderRadius: "4px",
          height: "6px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: dailyPct >= 90 ? "#ef4444" : dailyPct >= 70 ? "#f59e0b" : "#10b981",
            width: `${dailyPct}%`,
            height: "100%",
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  );
}

function SendCapBar({
  sent,
  cap,
  label,
}: {
  sent: number;
  cap: number;
  label: string;
}): JSX.Element {
  const pct = cap > 0 ? Math.min(100, (sent / cap) * 100) : 0;
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";
  return (
    <div style={{ marginBottom: "6px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.75rem",
          color: "#6b7280",
          marginBottom: "2px",
        }}
      >
        <span>{label}</span>
        <span>
          {sent} / {cap} ({Math.round(pct)}%)
        </span>
      </div>
      <div
        style={{ background: "#e5e7eb", borderRadius: "4px", height: "8px", overflow: "hidden" }}
      >
        <div
          style={{ background: color, width: `${pct}%`, height: "100%", transition: "width 0.3s" }}
        />
      </div>
    </div>
  );
}

function AnomalyStrip({ anomalies }: { anomalies: DomainAnomaly[] }): JSX.Element {
  if (anomalies.length === 0) return <></>;
  const hasCritical = anomalies.some((a) => a.severity === "critical");
  const bg = hasCritical ? "#fee2e2" : "#fef3c7";
  const border = hasCritical ? "#fca5a5" : "#fcd34d";
  const textColor = hasCritical ? "#991b1b" : "#92400e";
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "6px",
        padding: "12px 16px",
        marginBottom: "24px",
      }}
    >
      <strong style={{ color: textColor, display: "block", marginBottom: "8px" }}>
        {hasCritical ? "⚠ Critical Anomalies Detected" : "⚠ Warnings Detected"} (
        {anomalies.length})
      </strong>
      <ul style={{ margin: 0, paddingLeft: "20px" }}>
        {anomalies.map((a) => (
          <li key={a.id} style={{ color: textColor, marginBottom: "4px" }}>
            {a.severity === "critical" ? "🔴" : "🟡"}{" "}
            <strong>{a.anomaly_type.replace(/_/g, " ")}</strong>
            {a.domain ? ` [${a.domain}]` : ""}
            {a.org_id ? ` (org: ${a.org_id.slice(0, 8)}…)` : ""}: {a.message}
            <form action={resolveAnomalyAction} style={{ display: "inline", marginLeft: "8px" }}>
              <input type="hidden" name="anomalyId" value={a.id} />
              <button
                type="submit"
                style={{
                  fontSize: "0.7rem",
                  padding: "1px 6px",
                  background: "transparent",
                  border: `1px solid ${border}`,
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: textColor,
                }}
              >
                Resolve
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DomainCard({ domain }: { domain: SendingDomain }): JSX.Element {
  const bounceRateDisplay = (domain.bounce_rate * 100).toFixed(2);
  const spamRateDisplay = (domain.spam_complaint_rate * 100).toFixed(3);
  const bounceColor =
    domain.bounce_rate > 0.05
      ? "#991b1b"
      : domain.bounce_rate > 0.02
        ? "#92400e"
        : "#065f46";
  const spamColor =
    domain.spam_complaint_rate > 0.001
      ? "#991b1b"
      : domain.spam_complaint_rate > 0.0005
        ? "#92400e"
        : "#065f46";
  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "8px",
        }}
      >
        <div>
          <strong style={{ fontSize: "0.95rem" }}>{domain.domain}</strong>
          <div className="muted" style={{ fontSize: "0.75rem", marginTop: "2px" }}>
            org: {domain.org_id.slice(0, 8)}…
          </div>
        </div>
        <StatusPill status={domain.status} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: "0.7rem" }}>
            Bounce Rate
          </div>
          <div style={{ fontWeight: 700, color: bounceColor, fontSize: "1.1rem" }}>
            {bounceRateDisplay}%
          </div>
          <div className="muted" style={{ fontSize: "0.65rem" }}>
            threshold: 5%
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: "0.7rem" }}>
            Spam Rate
          </div>
          <div style={{ fontWeight: 700, color: spamColor, fontSize: "1.1rem" }}>
            {spamRateDisplay}%
          </div>
          <div className="muted" style={{ fontSize: "0.65rem" }}>
            threshold: 0.1%
          </div>
        </div>
      </div>
      <WarmupBar
        stage={domain.warmup_stage}
        dailySent={domain.daily_send_count}
        dailyTarget={domain.warmup_target_daily}
      />
      {domain.last_checked_at && (
        <div className="muted" style={{ fontSize: "0.7rem", marginTop: "8px" }}>
          Last checked: {new Date(domain.last_checked_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderHealth }): JSX.Element {
  const remaining = provider.rate_limit_remaining;
  const total = provider.rate_limit_total;
  const pct = total > 0 ? Math.min(100, (remaining / total) * 100) : 0;
  const usedPct = 100 - pct;
  const budgetColor = usedPct >= 90 ? "#ef4444" : usedPct >= 70 ? "#f59e0b" : "#10b981";
  const providerLabels: Record<string, string> = {
    apollo: "Apollo",
    proxycurl: "Proxycurl",
    sendgrid: "SendGrid",
  };
  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <strong style={{ fontSize: "1rem" }}>
          {providerLabels[provider.provider] ?? provider.provider}
        </strong>
        <StatusPill status={provider.status} />
      </div>
      {total > 0 ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "#6b7280",
              marginBottom: "4px",
            }}
          >
            <span>Rate budget used</span>
            <span>
              {total - remaining} / {total} ({Math.round(usedPct)}%)
            </span>
          </div>
          <div
            style={{
              background: "#e5e7eb",
              borderRadius: "4px",
              height: "8px",
              overflow: "hidden",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                background: budgetColor,
                width: `${usedPct}%`,
                height: "100%",
                transition: "width 0.3s",
              }}
            />
          </div>
          {provider.rate_limit_reset_at && (
            <div className="muted" style={{ fontSize: "0.7rem" }}>
              Resets: {new Date(provider.rate_limit_reset_at).toLocaleString()}
            </div>
          )}
        </>
      ) : (
        <div className="muted" style={{ fontSize: "0.8rem" }}>
          No rate limit data yet
        </div>
      )}
      {provider.last_error && (
        <div
          style={{
            marginTop: "8px",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: "4px",
            padding: "6px 8px",
            fontSize: "0.75rem",
            color: "#991b1b",
          }}
        >
          Last error: {provider.last_error}
        </div>
      )}
      <div className="muted" style={{ fontSize: "0.7rem", marginTop: "8px" }}>
        Checked: {new Date(provider.checked_at).toLocaleString()}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DeliverabilityPage(): Promise<JSX.Element> {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/login?redirect=/admin/deliverability");
  }

  const overview = await getDeliverabilityOverview();
  const { sendingDomains, tenantSendCaps, providerHealth, activeAnomalies, campaigns } = overview;

  const activeCampaigns = campaigns.filter(
    (c) => c.status !== "killed" && c.status !== "draft",
  );
  const killedCampaigns = campaigns.filter((c) => c.status === "killed");

  return (
    <main>
      <h1>Deliverability Console</h1>
      <p>
        Operator view — sending-domain reputation, tenant send caps, provider rate budgets, and
        campaign kill switches.
      </p>

      {/* ── Anomaly Alert Strip ─────────────────────────────────────── */}
      <AnomalyStrip anomalies={activeAnomalies} />

      {/* ── Sending Domains ─────────────────────────────────────────── */}
      <section style={{ marginBottom: "40px" }}>
        <h2>Sending Domains ({sendingDomains.length})</h2>
        {sendingDomains.length === 0 ? (
          <div className="empty">
            <p>No sending domains registered yet.</p>
            <p className="muted">
              Domains will appear here once the SendGrid webhook ingests bounce / complaint events.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
            }}
          >
            {sendingDomains.map((d) => (
              <DomainCard key={d.id} domain={d} />
            ))}
          </div>
        )}
      </section>

      {/* ── Provider Health ─────────────────────────────────────────── */}
      <section style={{ marginBottom: "40px" }}>
        <h2>Provider Health</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "16px",
          }}
        >
          {providerHealth.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      </section>

      {/* ── Tenant Send Caps ─────────────────────────────────────────── */}
      <section style={{ marginBottom: "40px" }}>
        <h2>Tenant Send Caps ({tenantSendCaps.length})</h2>
        {tenantSendCaps.length === 0 ? (
          <div className="empty">
            <p>No per-tenant caps configured yet.</p>
            <p className="muted">Caps are created automatically when a tenant first sends.</p>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: "16px",
            }}
          >
            {tenantSendCaps.map((cap) => (
              <div key={cap.id} className="card">
                <div style={{ marginBottom: "8px" }}>
                  <strong style={{ fontSize: "0.9rem" }}>
                    org: {cap.org_id.slice(0, 16)}…
                  </strong>
                  {cap.cap_override_reason && (
                    <div className="muted" style={{ fontSize: "0.75rem", marginTop: "2px" }}>
                      Override: {cap.cap_override_reason}
                    </div>
                  )}
                </div>
                <SendCapBar sent={cap.daily_sent} cap={cap.daily_cap} label="Daily" />
                <SendCapBar sent={cap.weekly_sent} cap={cap.weekly_cap} label="Weekly" />
                <div className="muted" style={{ fontSize: "0.7rem", marginTop: "6px" }}>
                  Updated: {new Date(cap.updated_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Campaign Kill Switch ─────────────────────────────────────── */}
      <section style={{ marginBottom: "40px" }}>
        <h2>Campaign Kill Switch</h2>
        <p className="muted" style={{ marginBottom: "16px" }}>
          Killing a campaign immediately stops all queued sends. Use with caution.
        </p>

        {campaigns.length === 0 ? (
          <div className="empty">
            <p>No campaigns found.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Org</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted" style={{ fontSize: "0.8rem" }}>
                    {c.org_id.slice(0, 8)}…
                  </td>
                  <td>
                    <StatusPill status={c.status} />
                  </td>
                  <td className="muted" style={{ fontSize: "0.8rem" }}>
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    {c.status !== "killed" ? (
                      <form action={campaignKillAction}>
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="action" value="kill" />
                        <button
                          type="submit"
                          style={{
                            background: "#ef4444",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            padding: "4px 12px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          Kill
                        </button>
                      </form>
                    ) : (
                      <form action={campaignKillAction}>
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input type="hidden" name="action" value="revive" />
                        <button
                          type="submit"
                          style={{
                            background: "#10b981",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            padding: "4px 12px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                          }}
                        >
                          Revive
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {(activeCampaigns.length > 0 || killedCampaigns.length > 0) && (
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "12px" }}>
            {activeCampaigns.length} active · {killedCampaigns.length} killed
          </div>
        )}
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="muted" style={{ fontSize: "0.75rem", borderTop: "1px solid #e5e7eb", paddingTop: "16px" }}>
        Logged in as {admin.email} · Data refreshes on page reload
      </div>
    </main>
  );
}
