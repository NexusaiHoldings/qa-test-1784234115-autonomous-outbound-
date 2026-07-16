/**
 * Reply-intent classifier for SDR inbound prospect replies.
 *
 * Calls the AI gateway (OpenAI-compatible, gpt-5.4-mini) to label each
 * inbound reply with one of the four intent classes from the CEO briefing
 * (interested / objection / not_interested / out_of_office) plus an "other"
 * catch-all. Binary routing:
 *   - escalate to founder: interested OR sensitive objection (legal/hostile)
 *   - continue autonomously: not_interested, out_of_office, plain objection
 */

export const REPLY_LABELS = [
  "interested",
  "objection",
  "not_interested",
  "out_of_office",
  "other",
] as const;

export type ReplyLabel = (typeof REPLY_LABELS)[number];

export interface ClassificationResult {
  label: ReplyLabel;
  confidence: number;
  reasoning: string;
  shouldEscalate: boolean;
  escalationReason: string | null;
  draftFollowUp: string | null;
}

export interface ClassifyInput {
  rawReply: string;
  prospectName: string;
  prospectTitle: string | null;
  company: string;
  originalSubject: string;
  originalBody: string;
  touchNumber: number;
}

const SENSITIVE_KEYWORDS = [
  "legal",
  "lawyer",
  "attorney",
  "lawsuit",
  "cease",
  "desist",
  "threatening",
  "hostile",
  "harass",
  "sue",
  "litigation",
  "gdpr",
  "spam complaint",
  "report you",
];

function hasSensitiveContent(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

function determineEscalation(
  label: ReplyLabel,
  rawReply: string,
  reasoning: string,
  llmEscalate: boolean,
): { shouldEscalate: boolean; escalationReason: string | null } {
  if (label === "interested") {
    return {
      shouldEscalate: true,
      escalationReason: "Prospect shows genuine buying interest — founder should take over",
    };
  }
  if (label === "objection" && (hasSensitiveContent(rawReply) || hasSensitiveContent(reasoning))) {
    return {
      shouldEscalate: true,
      escalationReason: "Objection contains legal or hostile language — requires founder review",
    };
  }
  if (llmEscalate && label !== "not_interested" && label !== "out_of_office") {
    return {
      shouldEscalate: true,
      escalationReason: "AI flagged edge case requiring human review",
    };
  }
  return { shouldEscalate: false, escalationReason: null };
}

export async function classifyReplyIntent(
  input: ClassifyInput,
): Promise<ClassificationResult> {
  const systemPrompt = `You are an expert at classifying B2B cold-email replies for an AI-powered SDR platform.

Classify the prospect's reply into EXACTLY ONE of these intent labels:
- "interested": Prospect shows genuine interest — wants to learn more, asks qualifying questions, suggests a meeting, says "tell me more", or otherwise engages positively
- "objection": Prospect raises a concern — pricing, timing, wrong fit, already has a solution, or general pushback (escalate automatically if legal/hostile language is present)
- "not_interested": Prospect clearly declines — "not interested", "remove me", "stop emailing", "no thank you"
- "out_of_office": Auto-reply, OOO message, or vacation responder
- "other": Referral to another person, ambiguous, unclassifiable, or empty reply

Escalation rule (set should_escalate = true when):
- Label is "interested" (ALWAYS escalate — every buying conversation must reach the founder)
- Label is "objection" AND the reply contains legal threats, hostile language, or cease-and-desist intent

For non-escalated replies (not_interested, out_of_office, plain objection), write a concise follow-up draft (≤80 words, no placeholder text, no brackets, natural tone).
For escalated replies set draft_follow_up to null.

Return ONLY valid JSON with exactly these keys:
{
  "label": "interested|objection|not_interested|out_of_office|other",
  "confidence": 0.0 to 1.0,
  "reasoning": "1–2 sentence explanation of the classification decision",
  "should_escalate": true or false,
  "escalation_reason": "string describing why, or null",
  "draft_follow_up": "follow-up email body text or null"
}`;

  const bodyPreview =
    input.originalBody.length > 600
      ? input.originalBody.slice(0, 600) + "…"
      : input.originalBody;

  const userPrompt = `PROSPECT: ${input.prospectName}${input.prospectTitle ? ` (${input.prospectTitle})` : ""} at ${input.company}
ORIGINAL EMAIL SUBJECT: ${input.originalSubject}
TOUCH: ${input.touchNumber} of 3
ORIGINAL EMAIL:
${bodyPreview}

PROSPECT REPLY:
${input.rawReply}

Classify this reply and provide the routing decision.`;

  const baseUrl = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com";
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.15,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `AI gateway error ${response.status}: ${errText.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from AI gateway");
  }

  let parsed: {
    label?: string;
    confidence?: number;
    reasoning?: string;
    should_escalate?: boolean;
    escalation_reason?: string | null;
    draft_follow_up?: string | null;
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    throw new Error(
      `Failed to parse gateway JSON: ${content.slice(0, 200)}`,
    );
  }

  const label: ReplyLabel = (REPLY_LABELS as readonly string[]).includes(
    parsed.label ?? "",
  )
    ? (parsed.label as ReplyLabel)
    : "other";

  const confidence =
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;

  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

  const { shouldEscalate, escalationReason } = determineEscalation(
    label,
    input.rawReply,
    reasoning,
    parsed.should_escalate === true,
  );

  const draftFollowUp = shouldEscalate
    ? null
    : typeof parsed.draft_follow_up === "string" && parsed.draft_follow_up.trim()
      ? parsed.draft_follow_up.trim()
      : null;

  return {
    label,
    confidence,
    reasoning,
    shouldEscalate,
    escalationReason,
    draftFollowUp,
  };
}
