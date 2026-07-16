import type { JSX } from "react";
import Link from "next/link";
import { listCampaigns } from "@/lib/sdr/campaigns";
import { VERTICAL_TEMPLATES } from "@/lib/sdr/vertical-templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CampaignsPage(): Promise<JSX.Element> {
  const campaigns = await listCampaigns();

  return (
    <main>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1>SDR Campaigns</h1>
          <p>Manage your AI-powered outbound campaigns and ICP configurations.</p>
        </div>
        {campaigns.length > 0 && (
          <Link href="/campaigns/new" className="btn">
            New Campaign
          </Link>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="empty" style={{ marginTop: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🚀</div>
          <h2 style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            Launch your first SDR campaign
          </h2>
          <p className="muted" style={{ maxWidth: 480, margin: "0 auto 1.5rem" }}>
            Configure your Ideal Customer Profile in under 20 minutes. The wizard
            captures your target vertical, geography, firm size, and sending
            preferences — then generates a live cold-email preview as you build.
          </p>
          <Link href="/campaigns/new" className="btn">
            Launch your first SDR campaign
          </Link>
        </div>
      ) : (
        <table style={{ marginTop: "1.5rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Campaign</th>
              <th style={{ textAlign: "left" }}>Vertical</th>
              <th style={{ textAlign: "left" }}>Geography</th>
              <th style={{ textAlign: "left" }}>Firm Size</th>
              <th style={{ textAlign: "left" }}>Tone</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const verticalLabel =
                VERTICAL_TEMPLATES[c.vertical as keyof typeof VERTICAL_TEMPLATES]
                  ?.label ?? c.vertical;
              const createdDate = new Date(c.created_at).toLocaleDateString(
                "en-US",
                { month: "short", day: "numeric", year: "numeric" },
              );
              const statusColor =
                c.status === "active"
                  ? "#16a34a"
                  : c.status === "paused"
                    ? "#d97706"
                    : "#6b7280";
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{verticalLabel}</td>
                  <td>{c.geography || "—"}</td>
                  <td>
                    {c.firm_size_min === c.firm_size_max
                      ? c.firm_size_min
                      : `${c.firm_size_min}–${c.firm_size_max}`}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{c.tone}</td>
                  <td>
                    <span
                      style={{
                        color: statusColor,
                        fontWeight: 500,
                        textTransform: "capitalize",
                      }}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="muted">{createdDate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
