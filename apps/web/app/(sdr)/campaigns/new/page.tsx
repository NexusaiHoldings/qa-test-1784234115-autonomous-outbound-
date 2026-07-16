"use client";

import { useState, useTransition, type JSX } from "react";
import { useRouter } from "next/navigation";
import {
  VERTICAL_TEMPLATES,
  REVENUE_BAND_LABELS,
  generateEmailPreview,
  type VerticalKey,
  type ToneKey,
  type RevenueBand,
} from "@/lib/sdr/vertical-templates";
import { createCampaign } from "@/lib/sdr/campaigns";

// ── Wizard state ────────────────────────────────────────────────────────────

interface WizardState {
  vertical: VerticalKey | null;
  geography: string;
  firmSizeMin: number;
  firmSizeMax: number;
  revenueBand: RevenueBand | null;
  sendingDays: string[];
  sendingStart: string;
  sendingEnd: string;
  tone: ToneKey | null;
  campaignName: string;
}

const DEFAULT_STATE: WizardState = {
  vertical: null,
  geography: "",
  firmSizeMin: 1,
  firmSizeMax: 10,
  revenueBand: null,
  sendingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  sendingStart: "09:00",
  sendingEnd: "17:00",
  tone: null,
  campaignName: "",
};

const WEEKDAYS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

const STEP_TITLES = [
  "Target vertical",
  "Geography",
  "Firm size",
  "Revenue band",
  "Sending window",
  "Tone",
  "Review & launch",
];

const TONE_OPTIONS: { key: ToneKey; label: string; description: string }[] = [
  {
    key: "professional",
    label: "Professional",
    description: "Formal, polished, and credibility-first.",
  },
  {
    key: "conversational",
    label: "Conversational",
    description: "Friendly, approachable, and peer-to-peer.",
  },
  {
    key: "direct",
    label: "Direct",
    description: "Brief, confident, and time-respecting.",
  },
];

// ── Preview component ───────────────────────────────────────────────────────

function EmailPreview({ state }: { state: WizardState }): JSX.Element {
  if (!state.vertical) {
    return (
      <div
        style={{
          padding: "2rem",
          border: "1px dashed #d1d5db",
          borderRadius: 8,
          color: "#9ca3af",
          fontSize: 14,
          lineHeight: 1.6,
          minHeight: 320,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          gap: "0.5rem",
        }}
      >
        <div style={{ fontSize: 28 }}>✉️</div>
        <p style={{ margin: 0, fontWeight: 500, color: "#6b7280" }}>
          Live email preview
        </p>
        <p style={{ margin: 0 }}>
          Select a vertical to see a sample cold email regenerate as you build
          your ICP.
        </p>
      </div>
    );
  }

  const preview = generateEmailPreview(state.vertical, {
    geography: state.geography,
    firmSizeMin: state.firmSizeMin,
    firmSizeMax: state.firmSizeMax,
    revenueBand: state.revenueBand,
    tone: state.tone,
  });

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        overflow: "hidden",
        fontSize: 14,
        lineHeight: 1.7,
      }}
    >
      <div
        style={{
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
          padding: "0.75rem 1rem",
          fontSize: 11,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        Sample cold email preview
      </div>
      <div style={{ padding: "1rem", background: "#ffffff" }}>
        <div
          style={{
            marginBottom: "0.75rem",
            paddingBottom: "0.75rem",
            borderBottom: "1px solid #f3f4f6",
          }}
        >
          <span style={{ color: "#9ca3af", fontSize: 12 }}>Subject: </span>
          <span style={{ fontWeight: 600, color: "#111827" }}>
            {preview.subject}
          </span>
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            color: "#374151",
            fontSize: 14,
          }}
        >
          {preview.body}
        </pre>
      </div>
    </div>
  );
}

// ── Stepper header ──────────────────────────────────────────────────────────

function StepperHeader({
  step,
  total,
}: {
  step: number;
  total: number;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "2rem",
      }}
    >
      {STEP_TITLES.map((title, idx) => {
        const isActive = idx === step;
        const isDone = idx < step;
        return (
          <div
            key={idx}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                background: isActive
                  ? "#2563eb"
                  : isDone
                    ? "#dbeafe"
                    : "#f3f4f6",
                color: isActive ? "#fff" : isDone ? "#2563eb" : "#9ca3af",
                flexShrink: 0,
              }}
            >
              {isDone ? "✓" : idx + 1}
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#111827" : "#9ca3af",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </span>
            {idx < total - 1 && (
              <div
                style={{
                  width: 24,
                  height: 1,
                  background: isDone ? "#2563eb" : "#e5e7eb",
                  marginLeft: "0.25rem",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main wizard page ────────────────────────────────────────────────────────

export default function NewCampaignPage(): JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]): void {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function canAdvance(): boolean {
    switch (step) {
      case 0:
        return state.vertical !== null;
      case 1:
        return state.geography.trim().length > 0;
      case 2:
        return state.firmSizeMin <= state.firmSizeMax;
      case 3:
        return state.revenueBand !== null;
      case 4:
        return state.sendingDays.length > 0;
      case 5:
        return state.tone !== null;
      case 6:
        return state.campaignName.trim().length > 0;
      default:
        return true;
    }
  }

  function handleSubmit(): void {
    setSubmitError(null);
    startTransition(async () => {
      const result = await createCampaign({
        name: state.campaignName.trim(),
        vertical: state.vertical ?? "",
        geography: state.geography,
        firmSizeMin: state.firmSizeMin,
        firmSizeMax: state.firmSizeMax,
        revenueBand: state.revenueBand ?? "",
        sendingWindowDays: state.sendingDays,
        sendingWindowStart: state.sendingStart,
        sendingWindowEnd: state.sendingEnd,
        tone: state.tone ?? "professional",
        templateKey: state.vertical ?? "",
      });
      if (result.ok) {
        router.push("/campaigns");
      } else {
        setSubmitError(result.error);
      }
    });
  }

  function renderStep(): JSX.Element {
    switch (step) {
      case 0:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>
              Which vertical are you targeting?
            </h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              Choose the industry your prospects work in. This shapes the email
              messaging and subject lines.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {(Object.values(VERTICAL_TEMPLATES) as typeof VERTICAL_TEMPLATES[VerticalKey][]).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => update("vertical", t.key)}
                  style={{
                    padding: "1rem",
                    borderRadius: 8,
                    border:
                      state.vertical === t.key
                        ? "2px solid #2563eb"
                        : "2px solid #e5e7eb",
                    background:
                      state.vertical === t.key ? "#eff6ff" : "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: "0.25rem",
                      color: state.vertical === t.key ? "#1d4ed8" : "#111827",
                    }}
                  >
                    {t.label}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {t.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 1:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>
              Where are your target clients?
            </h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              Enter a city, metro area, state, or region. This grounds the
              outreach in a specific market.
            </p>
            <input
              type="text"
              value={state.geography}
              onChange={(e) => update("geography", e.target.value)}
              placeholder="e.g. Chicago, IL  ·  Southeast US  ·  New York metro"
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                fontSize: 16,
                borderRadius: 8,
                border: "1px solid #d1d5db",
                outline: "none",
              }}
              autoFocus
            />
          </div>
        );

      case 2:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>
              How large is your ideal target firm?
            </h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              Set a headcount range. This tunes the email messaging to firms of
              this size.
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1.5rem",
                flexWrap: "wrap",
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>Minimum</span>
                <input
                  type="number"
                  min={1}
                  max={state.firmSizeMax}
                  value={state.firmSizeMin}
                  onChange={(e) =>
                    update("firmSizeMin", Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  style={{
                    width: 80,
                    padding: "0.5rem 0.75rem",
                    fontSize: 18,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    textAlign: "center",
                  }}
                />
              </label>
              <span style={{ fontSize: 18, color: "#9ca3af", marginTop: "1.25rem" }}>
                —
              </span>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>Maximum</span>
                <input
                  type="number"
                  min={state.firmSizeMin}
                  max={500}
                  value={state.firmSizeMax}
                  onChange={(e) =>
                    update(
                      "firmSizeMax",
                      Math.max(
                        state.firmSizeMin,
                        parseInt(e.target.value, 10) || state.firmSizeMin,
                      ),
                    )
                  }
                  style={{
                    width: 80,
                    padding: "0.5rem 0.75rem",
                    fontSize: 18,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    textAlign: "center",
                  }}
                />
              </label>
              <span style={{ fontSize: 14, color: "#6b7280", marginTop: "1.25rem" }}>
                employees
              </span>
            </div>
          </div>
        );

      case 3:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>
              What is their approximate annual revenue?
            </h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              Revenue context shapes the value proposition — a $500K firm needs
              different messaging than a $5M firm.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {(Object.entries(REVENUE_BAND_LABELS) as [RevenueBand, string][]).map(
                ([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => update("revenueBand", key)}
                    style={{
                      padding: "0.875rem 1.25rem",
                      borderRadius: 8,
                      border:
                        state.revenueBand === key
                          ? "2px solid #2563eb"
                          : "2px solid #e5e7eb",
                      background:
                        state.revenueBand === key ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                      fontWeight: state.revenueBand === key ? 600 : 400,
                      color: state.revenueBand === key ? "#1d4ed8" : "#111827",
                      fontSize: 15,
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
        );

      case 4:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>
              When should emails go out?
            </h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              The AI sends emails only within your configured window to maximise
              open rates and respect business hours.
            </p>
            <div style={{ marginBottom: "1.25rem" }}>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: "0.5rem" }}>
                Days
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {WEEKDAYS.map(({ key, label }) => {
                  const active = state.sendingDays.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        update(
                          "sendingDays",
                          active
                            ? state.sendingDays.filter((d) => d !== key)
                            : [...state.sendingDays, key],
                        )
                      }
                      style={{
                        padding: "0.5rem 0.875rem",
                        borderRadius: 6,
                        border: active
                          ? "2px solid #2563eb"
                          : "2px solid #e5e7eb",
                        background: active ? "#eff6ff" : "#fff",
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        color: active ? "#1d4ed8" : "#374151",
                        fontSize: 14,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>Start time</span>
                <input
                  type="time"
                  value={state.sendingStart}
                  onChange={(e) => update("sendingStart", e.target.value)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 15,
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                <span style={{ fontSize: 13, color: "#6b7280" }}>End time</span>
                <input
                  type="time"
                  value={state.sendingEnd}
                  onChange={(e) => update("sendingEnd", e.target.value)}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 15,
                  }}
                />
              </label>
            </div>
          </div>
        );

      case 5:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>What tone fits your brand?</h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              The AI writes every email in this voice. See the preview update
              live as you switch.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {TONE_OPTIONS.map(({ key, label, description }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => update("tone", key)}
                  style={{
                    padding: "1rem 1.25rem",
                    borderRadius: 8,
                    border:
                      state.tone === key
                        ? "2px solid #2563eb"
                        : "2px solid #e5e7eb",
                    background: state.tone === key ? "#eff6ff" : "#fff",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: state.tone === key ? "#1d4ed8" : "#111827",
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontSize: 13, color: "#6b7280" }}>
                    {description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );

      case 6:
        return (
          <div>
            <h2 style={{ marginBottom: "0.5rem" }}>Review & launch</h2>
            <p className="muted" style={{ marginBottom: "1.5rem" }}>
              Name your campaign, review your ICP, then click Launch.
            </p>
            <div style={{ marginBottom: "1.5rem" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  color: "#6b7280",
                  marginBottom: "0.375rem",
                }}
              >
                Campaign name
              </label>
              <input
                type="text"
                value={state.campaignName}
                onChange={(e) => update("campaignName", e.target.value)}
                placeholder={`${VERTICAL_TEMPLATES[state.vertical ?? "legal"]?.label ?? ""} — ${state.geography || "All markets"}`}
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  fontSize: 16,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  outline: "none",
                }}
                autoFocus
              />
            </div>
            <div className="card" style={{ fontSize: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {[
                    [
                      "Vertical",
                      VERTICAL_TEMPLATES[state.vertical ?? "legal"]?.label ?? "—",
                    ],
                    ["Geography", state.geography || "—"],
                    [
                      "Firm size",
                      state.firmSizeMin === state.firmSizeMax
                        ? `${state.firmSizeMin} employees`
                        : `${state.firmSizeMin}–${state.firmSizeMax} employees`,
                    ],
                    [
                      "Revenue band",
                      state.revenueBand
                        ? REVENUE_BAND_LABELS[state.revenueBand]
                        : "—",
                    ],
                    [
                      "Sending days",
                      state.sendingDays
                        .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
                        .join(", "),
                    ],
                    [
                      "Sending hours",
                      `${state.sendingStart} – ${state.sendingEnd}`,
                    ],
                    ["Tone", state.tone ?? "—"],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td
                        style={{
                          padding: "0.5rem 0",
                          color: "#6b7280",
                          width: 140,
                          verticalAlign: "top",
                        }}
                      >
                        {label}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem 0",
                          fontWeight: 500,
                          color: "#111827",
                        }}
                      >
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {submitError && (
              <p
                role="alert"
                style={{
                  marginTop: "1rem",
                  color: "#dc2626",
                  fontSize: 14,
                  padding: "0.75rem 1rem",
                  background: "#fef2f2",
                  borderRadius: 8,
                  border: "1px solid #fca5a5",
                }}
              >
                {submitError}
              </p>
            )}
          </div>
        );

      default:
        return <div />;
    }
  }

  return (
    <main>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1>New SDR Campaign</h1>
        <p>Configure your ICP and campaign parameters in under 20 minutes.</p>
      </div>

      <StepperHeader step={step} total={STEP_TITLES.length} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: "2rem",
          alignItems: "start",
        }}
      >
        {/* Left: active step */}
        <div>
          {renderStep()}

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "2rem",
              gap: "1rem",
            }}
          >
            {step > 0 ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setStep((s) => s - 1)}
                disabled={isPending}
              >
                Back
              </button>
            ) : (
              <span />
            )}
            {step < STEP_TITLES.length - 1 ? (
              <button
                type="button"
                className="btn"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance()}
                style={{
                  opacity: canAdvance() ? 1 : 0.4,
                  cursor: canAdvance() ? "pointer" : "not-allowed",
                }}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={handleSubmit}
                disabled={isPending || !canAdvance()}
                style={{
                  opacity: canAdvance() && !isPending ? 1 : 0.4,
                  cursor: canAdvance() && !isPending ? "pointer" : "not-allowed",
                }}
              >
                {isPending ? "Launching…" : "Launch campaign"}
              </button>
            )}
          </div>
        </div>

        {/* Right rail: live email preview */}
        <div style={{ position: "sticky", top: "1.5rem" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.5rem",
            }}
          >
            Live preview
          </p>
          <EmailPreview state={state} />
          <p
            style={{
              fontSize: 11,
              color: "#9ca3af",
              marginTop: "0.5rem",
              lineHeight: 1.5,
            }}
          >
            Preview updates as you configure your ICP. The AI writes every
            outbound email in this style.
          </p>
        </div>
      </div>
    </main>
  );
}
