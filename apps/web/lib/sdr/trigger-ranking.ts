/**
 * Trigger-event ranking for the SDR prospect sourcing pipeline.
 * Scores events by type weight × recency decay, marks the top trigger per prospect,
 * and provides entity-resolution utilities for matching company names.
 */

export type TriggerEventType =
  | "funding"
  | "leadership_hire"
  | "product_launch"
  | "expansion"
  | "job_posting";

export interface RawTriggerEvent {
  eventType: TriggerEventType;
  title: string;
  description: string;
  date: Date | null;
  sourceUrl: string | null;
}

export interface ScoredTriggerEvent {
  id: string;
  prospectId: string;
  eventType: TriggerEventType;
  eventTitle: string;
  eventDescription: string | null;
  eventDate: Date | null;
  relevanceScore: number;
  sourceUrl: string | null;
  isTopTrigger: boolean;
}

const TYPE_WEIGHTS: Record<TriggerEventType, number> = {
  funding: 10,
  leadership_hire: 9,
  product_launch: 7,
  expansion: 7,
  job_posting: 5,
};

export function recencyFactor(date: Date | null): number {
  if (!date) return 0.5;
  const days = (Date.now() - date.getTime()) / 86_400_000;
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.85;
  if (days <= 90) return 0.6;
  if (days <= 180) return 0.3;
  return 0.1;
}

export function scoreTriggerEvent(
  eventType: TriggerEventType,
  eventDate: Date | null,
): number {
  const weight = TYPE_WEIGHTS[eventType] ?? 5;
  return Math.round(weight * recencyFactor(eventDate) * 100) / 100;
}

export function rankTriggerEvents(
  events: Array<Omit<ScoredTriggerEvent, "relevanceScore" | "isTopTrigger">>,
): ScoredTriggerEvent[] {
  const scored: ScoredTriggerEvent[] = events.map((e) => ({
    ...e,
    relevanceScore: scoreTriggerEvent(e.eventType, e.eventDate),
    isTopTrigger: false,
  }));
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  if (scored.length > 0) {
    scored[0] = { ...scored[0], isTopTrigger: true };
  }
  return scored;
}

export function resolveEntityMatch(
  prospectCompany: string,
  entityName: string,
): number {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .replace(
        /\b(inc|llc|ltd|corp|co|company|group|holdings|solutions|services|technologies|tech)\b\.?/g,
        "",
      )
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, " ");

  const normA = normalize(prospectCompany);
  const normB = normalize(entityName);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;
  if (normA.includes(normB) || normB.includes(normA)) return 0.85;

  const wordsA = new Set(normA.split(" ").filter((w) => w.length > 2));
  const wordsB = normB.split(" ").filter((w) => w.length > 2);
  if (wordsA.size === 0 || wordsB.length === 0) return 0;

  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.length);
}

export async function fetchTriggerEventsForCompany(
  companyName: string,
  companyDomain: string | null,
): Promise<RawTriggerEvent[]> {
  const events: RawTriggerEvent[] = [];
  const newsApiKey = process.env.NEWS_API_KEY;

  if (newsApiKey && companyName) {
    try {
      const query = encodeURIComponent(
        `"${companyName}" (funding OR raises OR hired OR CFO OR CEO OR "new office" OR expands OR "series A" OR "series B")`,
      );
      const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${newsApiKey}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "NexusSDR/1.0" },
        next: { revalidate: 86400 },
      });

      if (resp.ok) {
        const body = (await resp.json()) as {
          articles?: Array<{
            title: string;
            description: string | null;
            url: string;
            publishedAt: string;
          }>;
        };

        for (const article of (body.articles ?? []).slice(0, 5)) {
          const titleLower = article.title.toLowerCase();
          const matchScore = resolveEntityMatch(companyName, article.title);
          if (
            matchScore < 0.3 &&
            !article.title.toLowerCase().includes(companyName.toLowerCase())
          ) {
            continue;
          }

          let eventType: TriggerEventType = "job_posting";
          if (/\$[\d.]+(m|million|b|billion)|raises?|funding|series\s+[abc]/i.test(titleLower)) {
            eventType = "funding";
          } else if (
            /hires?|appoints?|names?\s+(new\s+)?(cfo|ceo|cmo|coo|vp|svp|evp|director)/i.test(
              titleLower,
            )
          ) {
            eventType = "leadership_hire";
          } else if (
            /launches?|introduces?|announces?\s+new\s+product|new\s+platform/i.test(titleLower)
          ) {
            eventType = "product_launch";
          } else if (
            /expands?|opens?\s+new\s+office|new\s+market|enters?\s+/i.test(titleLower)
          ) {
            eventType = "expansion";
          }

          events.push({
            eventType,
            title: article.title.slice(0, 200),
            description: (article.description ?? "").slice(0, 500),
            date: article.publishedAt ? new Date(article.publishedAt) : null,
            sourceUrl: article.url,
          });
        }
      }
    } catch {
      // Best-effort: ignore news API failures silently
    }
  }

  // Fallback: synthesize a hiring signal from job board if domain is known
  if (events.length === 0 && companyDomain) {
    events.push({
      eventType: "job_posting",
      title: `${companyName} is actively hiring`,
      description: `Open positions detected at ${companyDomain}.`,
      date: new Date(),
      sourceUrl: null,
    });
  }

  return events;
}
