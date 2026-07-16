import type { JSX } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import {
  listSuppressions,
  addSuppressionAction,
  removeSuppressionAction,
  importSuppressionsCsvAction,
} from "@/lib/sdr/suppression";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function isAuthenticated(): Promise<boolean> {
  const token = cookies().get("session_token")?.value;
  if (!token) return false;
  try {
    const result = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    return result.status === 200;
  } catch {
    return false;
  }
}

const REASON_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  unsubscribed: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  manual: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
  bounced: { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
};

function ReasonBadge({ reason }: { reason: string }): JSX.Element {
  const colors = REASON_COLORS[reason] ?? {
    bg: "#f3f4f6",
    text: "#374151",
    border: "#e5e7eb",
  };
  const label = reason.charAt(0).toUpperCase() + reason.slice(1);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        textTransform: "capitalize",
      }}
    >
      {label}
    </span>
  );
}

export default async function SuppressionsPage(): Promise<JSX.Element> {
  const authed = await isAuthenticated();

  if (!authed) {
    return (
      <main>
        <h1>Suppression List</h1>
        <p>Sign in to manage your do-not-contact list.</p>
        <Link href="/login" className="btn">
          Sign in
        </Link>
      </main>
    );
  }

  const suppressions = await listSuppressions();

  return (
    <main>
      <h1>Suppression List</h1>
      <p>
        Contacts on this list will never receive outreach emails. Unsubscribes
        are added automatically; you can also add addresses manually or import
        an existing do-not-contact list.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
          marginTop: "1.75rem",
          marginBottom: "2rem",
        }}
      >
        {/* Manual add */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            Add address manually
          </h2>
          <form action={addSuppressionAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <input
              type="email"
              name="email"
              required
              placeholder="contact@example.com"
              style={{ width: "100%" }}
            />
            <select name="reason" defaultValue="manual" style={{ width: "100%" }}>
              <option value="manual">Manual / do-not-contact</option>
              <option value="bounced">Hard bounce</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
            <input
              type="text"
              name="notes"
              placeholder="Notes (optional)"
              style={{ width: "100%" }}
            />
            <button type="submit">Add to list</button>
          </form>
        </div>

        {/* CSV import */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem" }}>
            Import from CSV
          </h2>
          <form action={importSuppressionsCsvAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <textarea
              name="csv"
              required
              rows={5}
              placeholder={"email\njane@example.com\nbob@example.com"}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 13, resize: "vertical" }}
            />
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              One email per line. Optional header row is auto-detected. First
              CSV column is used as the email address.
            </p>
            <button type="submit">Import</button>
          </form>
        </div>
      </div>

      {suppressions.length === 0 ? (
        <div className="empty">
          <p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>
            No suppressions yet
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            Add addresses above or wait for the first unsubscribe — links are
            included automatically in every outreach email.
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            {suppressions.length} address{suppressions.length !== 1 ? "es" : ""} suppressed
          </p>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Email</th>
                <th style={{ textAlign: "left" }}>Reason</th>
                <th style={{ textAlign: "left" }}>Notes</th>
                <th style={{ textAlign: "left" }}>Added</th>
                <th style={{ textAlign: "left" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {suppressions.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 13 }}>{s.email}</td>
                  <td>
                    <ReasonBadge reason={s.reason} />
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {s.notes ?? "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="email" value={s.email} />
                      <button
                        type="submit"
                        style={{
                          background: "none",
                          border: "none",
                          color: "#dc2626",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        Remove
                      </button>
                    </form>
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
