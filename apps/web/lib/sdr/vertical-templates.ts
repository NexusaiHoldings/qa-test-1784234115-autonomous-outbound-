/**
 * Vertical template definitions and live email preview generator for the
 * ICP configuration wizard. Pure functions — no API calls.
 */

export type VerticalKey =
  | "legal"
  | "accounting"
  | "it_msp"
  | "marketing_agency"
  | "hr_consulting";

export type ToneKey = "professional" | "conversational" | "direct";

export type RevenueBand =
  | "under_500k"
  | "500k_2m"
  | "2m_5m"
  | "5m_10m"
  | "over_10m";

export interface VerticalTemplate {
  readonly key: VerticalKey;
  readonly label: string;
  readonly description: string;
  readonly painPoints: readonly string[];
}

export interface ICPParams {
  readonly geography: string;
  readonly firmSizeMin: number;
  readonly firmSizeMax: number;
  readonly revenueBand: RevenueBand | null;
  readonly tone: ToneKey | null;
}

export const REVENUE_BAND_LABELS: Record<RevenueBand, string> = {
  under_500k: "Under $500K / year",
  "500k_2m": "$500K – $2M / year",
  "2m_5m": "$2M – $5M / year",
  "5m_10m": "$5M – $10M / year",
  over_10m: "Over $10M / year",
};

export const VERTICAL_TEMPLATES: Record<VerticalKey, VerticalTemplate> = {
  legal: {
    key: "legal",
    label: "Law Firms",
    description: "Solo practitioners to boutique firms (1–15 attorneys)",
    painPoints: [
      "Non-billable admin eating attorney hours",
      "Slow client intake and matter setup",
      "Billing leakage and reconciliation overhead",
    ],
  },
  accounting: {
    key: "accounting",
    label: "Accounting / CPA",
    description: "CPA practices and bookkeeping firms",
    painPoints: [
      "Tax season client-document collection chaos",
      "Repeat follow-ups on missing information",
      "Proposal and engagement letter bottlenecks",
    ],
  },
  it_msp: {
    key: "it_msp",
    label: "IT / MSP",
    description: "Managed service providers and IT consultancies",
    painPoints: [
      "Level-1 ticket backlog slowing response time",
      "Reactive firefighting vs. proactive account growth",
      "Manual reporting for client QBRs",
    ],
  },
  marketing_agency: {
    key: "marketing_agency",
    label: "Marketing Agencies",
    description: "Digital and full-service marketing agencies",
    painPoints: [
      "Hours lost to manual client reporting",
      "Proposal and scope writing taking days",
      "Inconsistent new-business outreach",
    ],
  },
  hr_consulting: {
    key: "hr_consulting",
    label: "HR Consulting",
    description: "HR consultancies and PEO advisory firms",
    painPoints: [
      "Candidate screening eating consultant bandwidth",
      "Benefits and compliance admin for multiple clients",
      "Slow time-to-hire hurting client satisfaction",
    ],
  },
};

interface EmailLines {
  readonly subject: string;
  readonly greeting: string;
  readonly opener: string;
  readonly valueProp: string;
  readonly cta: string;
  readonly signoff: string;
}

function buildLines(
  vertical: VerticalKey,
  params: ICPParams,
): EmailLines {
  const { geography, firmSizeMin, firmSizeMax, revenueBand, tone } = params;
  const resolvedTone: ToneKey = tone ?? "professional";

  const firmRange =
    firmSizeMin === firmSizeMax
      ? `${firmSizeMin}-person`
      : `${firmSizeMin}–${firmSizeMax}-person`;

  const geoSuffix = geography.trim() ? ` in ${geography.trim()}` : "";

  const greeting =
    resolvedTone === "conversational"
      ? "Hi [First Name],"
      : resolvedTone === "direct"
        ? "[First Name],"
        : "Dear [First Name],";

  const signoff =
    resolvedTone === "conversational"
      ? "Talk soon,"
      : resolvedTone === "direct"
        ? "—"
        : "Best regards,";

  const revenueContext =
    revenueBand && revenueBand !== "under_500k"
      ? " at your revenue tier"
      : "";

  const verticalLines: Record<
    VerticalKey,
    Record<ToneKey, Omit<EmailLines, "greeting" | "signoff">>
  > = {
    legal: {
      professional: {
        subject:
          "Recovering 3+ non-billable hours per attorney per week",
        opener: `Most ${firmRange} law firms${geoSuffix} quietly lose 15–20% of billable capacity to client intake, matter updates, and billing reconciliation that accumulate between cases.`,
        valueProp: `We help practices like yours automate the intake and follow-up workflows that drain attorney time — without changing how your team works. Firms${revenueContext} typically reclaim 3–5 billable hours per attorney per week within the first month.`,
        cta: "Would a 15-minute call make sense to explore whether this fits your practice?",
      },
      conversational: {
        subject: "Quick question about admin overhead at your firm",
        opener: `I came across your firm and wanted to reach out. A lot of ${firmRange} practices${geoSuffix} tell us the same thing: non-billable admin has just become part of the job, even when it's clearly eating into revenue.`,
        valueProp: `We help law firms get those hours back through smarter intake and workflow automation. A few clients${revenueContext} have seen 3+ hours per attorney per week free up pretty quickly.`,
        cta: "Worth a quick chat to see if it makes sense for your situation?",
      },
      direct: {
        subject: "3–5 billable hours per attorney lost to admin — fixable",
        opener: `${firmRange} law firms${geoSuffix} typically lose 15–20% of attorney capacity to non-billable admin.`,
        valueProp: `We automate intake, matter updates, and billing follow-ups. Clients${revenueContext} recover 3–5 hours per attorney per week.`,
        cta: "15-minute call to see if it fits?",
      },
    },
    accounting: {
      professional: {
        subject: "Cutting client follow-up time 60% before next tax season",
        opener: `For ${firmRange} CPA practices${geoSuffix}, the weeks before and after tax deadlines are defined by chasing clients for documents — a pattern that costs the firm time and creates unnecessary stress.`,
        valueProp: `Our platform automates document collection, reminder sequences, and client status updates so your team can focus on the work that actually requires your expertise. Firms${revenueContext} consistently reduce client follow-up overhead by 50–60% in the first filing season.`,
        cta: "Would it be worth 15 minutes to walk through how this works for practices your size?",
      },
      conversational: {
        subject: "Tired of chasing clients for documents before deadlines?",
        opener: `I reached out because a lot of ${firmRange} accounting firms${geoSuffix} say the same thing around tax season: most of the chaos is just chasing clients for the same documents, over and over.`,
        valueProp: `We automate all of that — the reminders, the follow-ups, the status updates — so your team stops playing coordinator and starts doing actual accounting work. Practices${revenueContext} have cut that overhead by more than half.`,
        cta: "Happy to show you a quick demo if it sounds relevant?",
      },
      direct: {
        subject: "Stop chasing clients for documents. We automate it.",
        opener: `${firmRange} CPA firms${geoSuffix} spend 30–40% of staff time on client document follow-ups.`,
        valueProp: `We automate the entire intake and reminder workflow. Clients${revenueContext} cut that overhead by 60% in the first tax season.`,
        cta: "15 minutes to see if it fits your firm?",
      },
    },
    it_msp: {
      professional: {
        subject: "Reducing Level-1 ticket volume for MSPs your size",
        opener: `${firmRange} MSPs${geoSuffix} are often caught in a reactive loop — the same Level-1 issues consuming engineer time that should be going toward higher-margin work and account growth.`,
        valueProp: `We help managed service providers automate first-response triage and resolution for recurring ticket types, freeing your engineers for the work that actually moves the needle. MSPs${revenueContext} typically reduce Level-1 ticket volume by 35–45% within 60 days.`,
        cta: "Would a brief call to explore whether this applies to your ticket mix make sense?",
      },
      conversational: {
        subject: "How are you handling the Level-1 ticket backlog?",
        opener: `Reached out because most ${firmRange} MSPs${geoSuffix} we talk to are dealing with the same frustration: engineers spending half their day on L1 tickets that could honestly run themselves.`,
        valueProp: `We help teams like yours automate the repetitive first-response and resolution workflows so your engineers can focus on the clients and work that actually matter. The MSPs${revenueContext} we've worked with cut that backlog by 35–45%.`,
        cta: "Would love to show you how it works if you have 15 minutes?",
      },
      direct: {
        subject: "L1 ticket backlog killing engineer productivity?",
        opener: `${firmRange} MSPs${geoSuffix} lose 40–50% of engineer time to Level-1 tickets.`,
        valueProp: `We automate first-response triage and resolution. Clients${revenueContext} cut L1 volume by 35–45% in 60 days.`,
        cta: "15 minutes to see if it fits?",
      },
    },
    marketing_agency: {
      professional: {
        subject: "Reclaiming 10+ hours per week on client reporting",
        opener: `For ${firmRange} marketing agencies${geoSuffix}, client reporting consumes a disproportionate share of team bandwidth — hours that could otherwise go toward campaign strategy or new business development.`,
        valueProp: `We help agencies automate data aggregation, report generation, and client-facing updates so your team spends its time on work that actually differentiates you. Agencies${revenueContext} typically reclaim 10–15 hours per week per account manager within the first month.`,
        cta: "Would it be worth a 15-minute conversation to see whether this fits your reporting workflow?",
      },
      conversational: {
        subject: "How much time does your team lose to client reporting?",
        opener: `Reached out because this comes up constantly with ${firmRange} agencies${geoSuffix}: most of the week is eaten up by pulling numbers, building decks, and fielding client check-ins that could run on autopilot.`,
        valueProp: `We help agencies get that time back — automated reporting, smart client updates, and dashboards that answer the routine questions so your team handles the strategic ones. Account managers${revenueContext} have been reclaiming 10+ hours a week.`,
        cta: "Worth a quick chat to see if it makes sense for your team?",
      },
      direct: {
        subject: "10+ hours/week lost to client reporting. We fix it.",
        opener: `${firmRange} agencies${geoSuffix} spend 30–40% of account manager time on reporting and client updates.`,
        valueProp: `We automate data aggregation, reporting, and client communications. Agencies${revenueContext} reclaim 10–15 hours per account manager per week.`,
        cta: "15 minutes?",
      },
    },
    hr_consulting: {
      professional: {
        subject: "Reducing time-to-hire 35% without adding headcount",
        opener: `${firmRange} HR consultancies${geoSuffix} frequently find that candidate screening and status communications consume a disproportionate share of consultant time — effort that scales poorly as client demand grows.`,
        valueProp: `Our platform automates first-stage screening, candidate communication, and status tracking so your consultants focus on the judgment calls that require human expertise. Firms${revenueContext} have reduced average time-to-hire by 30–40% while maintaining the quality of placements.`,
        cta: "Would a 15-minute walkthrough be useful to see how this fits your workflow?",
      },
      conversational: {
        subject: "Too much time screening candidates manually?",
        opener: `I reached out because it's a common pain point for ${firmRange} HR consulting firms${geoSuffix}: the screening and candidate communication work is necessary but it's eating up consultant time that should go toward higher-value client work.`,
        valueProp: `We help teams like yours automate the repetitive parts of the hiring workflow — screening, scheduling, status updates — so your consultants focus on the work clients actually pay for. Firms${revenueContext} have cut time-to-hire by 30–40%.`,
        cta: "Happy to show you how it works if you have 15 minutes?",
      },
      direct: {
        subject: "30–40% faster time-to-hire. No new headcount.",
        opener: `${firmRange} HR consulting firms${geoSuffix} lose 40–50% of consultant time to manual screening and candidate communications.`,
        valueProp: `We automate screening, scheduling, and status updates. Clients${revenueContext} cut time-to-hire by 30–40%.`,
        cta: "15-minute call?",
      },
    },
  };

  const lines = verticalLines[vertical][resolvedTone];
  return { ...lines, greeting, signoff };
}

export function generateEmailPreview(
  vertical: VerticalKey,
  params: ICPParams,
): { subject: string; body: string } {
  const lines = buildLines(vertical, params);
  const body = [
    lines.greeting,
    "",
    lines.opener,
    "",
    lines.valueProp,
    "",
    lines.cta,
    "",
    lines.signoff,
    "[Your Name]",
    "[Company]",
  ].join("\n");

  return { subject: lines.subject, body };
}
