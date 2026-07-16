"use server";

/**
 * Trigger-grounded email composer for SDR sequences.
 * Calls the AI gateway (OpenAI-compatible, gpt-5.4-mini) to inject each
 * prospect's top trigger event into the campaign's vertical template,
 * producing benefit-led, never-truncated cold email copy.
 */

import { VERTICAL_TEMPLATES } from "@/lib/sdr/vertical-templates";

export const TEMPLATE_VERSION = "1.0";

export interface ComposedEmail {
  subject: string;
  body: string;
  templateVersion: string;
}

export interface ComposeEmailInput {
  prospectName: string;
  prospectTitle: string | null;
  company: string;
  vertical: string;
  tone: string;
  triggerEventType: string;
  triggerEventTitle: string;
  triggerEventDescription: string | null;
  touchNumber: 1 | 2 | 3;
}

const TOUCH_GUIDANCE: Record<number, string> = {
  1: "initial outreach — lead with the trigger event to establish timely relevance, then deliver the core benefit concisely",
  2: "first follow-up — acknowledge your prior email briefly, pivot to a different pain-point angle or a short customer proof point",
  3: "final follow-up — polite last attempt, acknowledge they may be busy, make it easy to reply with one word",
};

export async function composeEmail(
  input: ComposeEmailInput,
): Promise<ComposedEmail> {
  const template =
    VERTICAL_TEMPLATES[input.vertical as keyof typeof VERTICAL_TEMPLATES];
  const painPoints = template
    ? template.painPoints.slice(0, 2).join("; ")
    : "";
  const verticalLabel = template?.label ?? input.vertical;
  const guidance = TOUCH_GUIDANCE[input.touchNumber] ?? TOUCH_GUIDANCE[1];

  const systemPrompt = `You are an expert B2B cold-email copywriter specialising in benefit-led outbound for professional services firms.
Write concise, specific emails that ground the outreach in a real trigger event.
Never use placeholder text or ellipses. Every sentence must deliver concrete value.
Return ONLY valid JSON with exactly two keys: "subject" and "body".
Use \\n for line breaks in body. Keep the full email under 150 words.`;

  const userPrompt = `Write a cold email (touch ${input.touchNumber} of 3) with these parameters:

RECIPIENT:
- Name: ${input.prospectName}
- Title: ${input.prospectTitle ?? "Decision Maker"}
- Company: ${input.company}

TRIGGER EVENT (ground this email in the event — do not ignore it):
- Type: ${input.triggerEventType.replace(/_/g, " ")}
- Event: ${input.triggerEventTitle}
${input.triggerEventDescription ? `- Context: ${input.triggerEventDescription}` : ""}

VERTICAL: ${verticalLabel}
KEY PAIN POINTS: ${painPoints}
TONE: ${input.tone}

TOUCH CONTEXT: ${guidance}

Return JSON only — no markdown fences, no commentary.`;

  const baseUrl =
    process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com";
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
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `AI gateway error ${response.status}: ${errorText.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from AI gateway");
  }

  let parsed: { subject?: string; body?: string };
  try {
    parsed = JSON.parse(content) as { subject?: string; body?: string };
  } catch {
    throw new Error(
      `Failed to parse gateway JSON: ${content.slice(0, 200)}`,
    );
  }

  if (!parsed.subject || !parsed.body) {
    throw new Error(
      "Gateway response missing required 'subject' or 'body' fields",
    );
  }

  return {
    subject: parsed.subject,
    body: parsed.body,
    templateVersion: TEMPLATE_VERSION,
  };
}
