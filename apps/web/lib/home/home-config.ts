/**
 * home-config — the company's root surface (company-root-landing-001 +
 * homepage-composition-001). Written by provisioning (_step_substrate_install)
 * from the homepage composer / CTO home_mode + CMO positioning. Do NOT hand-edit.
 */
export interface HomeCta {
  label: string;
  href: string;
}

export interface HomeFeature {
  title: string;
  body: string;
}

export interface SectionImage {
  url?: string;
  alt?: string;
  caption?: string;
}

export interface HeroSection {
  type: "hero";
  eyebrow?: string;
  headline: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
  image?: SectionImage;
}
export interface StatsSection {
  type: "stats";
  title?: string;
  stats: { value: string; label: string }[];
}
export interface HowItWorksSection {
  type: "how_it_works";
  title?: string;
  subhead?: string;
  steps: { title: string; body: string }[];
}
export interface FeatureGridSection {
  type: "feature_grid";
  title?: string;
  subhead?: string;
  features: HomeFeature[];
}
export interface FeatureSpotlightSection {
  type: "feature_spotlight";
  title?: string;
  items: { title: string; body: string; image?: SectionImage }[];
}
export interface SocialProofSection {
  type: "social_proof";
  title?: string;
  quotes: { quote: string; author?: string; role?: string }[];
}
export interface FaqSection {
  type: "faq";
  title?: string;
  items: { q: string; a: string }[];
}
export interface PricingTeaserSection {
  type: "pricing_teaser";
  title?: string;
  subhead?: string;
  tiers: {
    name: string;
    price?: string;
    period?: string;
    features: string[];
    cta?: HomeCta;
    highlighted?: boolean;
  }[];
}
export interface GallerySection {
  type: "gallery";
  title?: string;
  images: SectionImage[];
}
export interface CtaBandSection {
  type: "cta_band";
  headline: string;
  subhead?: string;
  cta?: HomeCta;
}

export type HomeSection =
  | HeroSection
  | StatsSection
  | HowItWorksSection
  | FeatureGridSection
  | FeatureSpotlightSection
  | SocialProofSection
  | FaqSection
  | PricingTeaserSection
  | GallerySection
  | CtaBandSection;

export interface HomeConfig {
  mode: "landing" | "conversation";
  sections?: HomeSection[];
  headline?: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
  featuresTitle?: string;
  features?: HomeFeature[];
  closingHeadline?: string;
}

export const homeConfig: HomeConfig = {
  "mode": "landing",
  "headline": "Stop pricing out the $80K SDR you can't afford. Get your first booked meeting for $499/mo, flat. (Anchored to\u2026",
  "subhead": "Your first SDR at $499/mo flat \u2014 an autonomous AI agent that finds prospects, writes trigger-event-personalized cold emails, handles the first 2-3 reply touches, and books qualified meetings directly into your calendar with zero founder\u2026",
  "sections": [
    {
      "type": "hero",
      "headline": "Book More Meetings Without Hiring a Salesperson",
      "eyebrow": "Your AI Outbound SDR \u2014 $499/mo flat",
      "subhead": "An autonomous AI agent sources prospects, writes trigger-personalized cold emails, handles follow-ups, and drops qualified meetings straight into your calendar \u2014 for less than a week of SDR salary.",
      "primaryCta": {
        "label": "Start Free \u2014 First 50 Prospects On Us",
        "href": "/signup"
      },
      "secondaryCta": {
        "label": "See How It Works",
        "href": "#how-it-works"
      },
      "image": {
        "url": "hero_image"
      }
    },
    {
      "type": "stats",
      "stats": [
        {
          "value": "$499/mo",
          "label": "All-in flat rate \u2014 no credits, no add-ons, cancel anytime"
        },
        {
          "value": "vs. $70K+",
          "label": "Median fully-loaded cost of a US outbound SDR hire"
        },
        {
          "value": "50 prospects",
          "label": "Fully automated in your free trial, zero setup fee"
        },
        {
          "value": "1.8M+ firms",
          "label": "US B2B professional-services firms in your reachable ICP"
        }
      ],
      "title": "Built for Firms That Run on Referrals \u2014 and Want More"
    },
    {
      "type": "how_it_works",
      "steps": [
        {
          "title": "1. Define Your ICP in Plain English",
          "body": "Describe your ideal client \u2014 industry, company size, geography, job title. The agent translates that into live searches across Apollo, LinkedIn, and company news feeds."
        },
        {
          "title": "2. The Agent Sources and Verifies Prospects Daily",
          "body": "Every morning it pulls fresh leads, validates contact data, and flags trigger events \u2014 new funding, leadership changes, job posts, press mentions \u2014 that make your outreach timely and relevant."
        },
        {
          "title": "3. Personalized Emails Go Out in Your Voice",
          "body": "Each email is written around a specific trigger event, in vertical-appropriate language for legal, accounting, IT, or agency services. No mail-merge tokens \u2014 real sentences that read like a founder wrote them."
        },
        {
          "title": "4. Replies Are Handled; Meetings Land on Your Calendar",
          "body": "The agent classifies every reply \u2014 interested, not now, wrong person \u2014 and sends up to two intelligent follow-up touches. Interested prospects get a booking link; confirmed meetings sync directly to your calendar."
        }
      ],
      "title": "From Zero Pipeline to Booked Meetings \u2014 Automatically",
      "subhead": "No SDR training, no CRM setup, no prompt engineering. Tell us your ideal client; the agent handles everything else."
    },
    {
      "type": "feature_spotlight",
      "items": [
        {
          "title": "Trigger-Event Personalization at Scale",
          "body": "Generic cold email is dead. The agent monitors LinkedIn activity, company news, and hiring signals daily, then anchors every opening line to something real happening at that prospect's firm right now. A CPA firm that just posted a bookkeeper role gets a different email than one that just announced a new partner \u2014 automatically, at volume.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/d5cfbd01-3261-4c2e-b39d-9e54e6f4633d",
            "alt": "Trigger-Event Personalization at Scale"
          }
        },
        {
          "title": "Vertical-Specific Voice \u2014 Legal, Accounting, IT, Agencies",
          "body": "A compliance attorney and an IT MSP owner don't speak the same language. The agent writes in the register of each vertical \u2014 no jargon mismatches, no generic 'I help businesses grow' openers. Your outreach sounds like it came from someone who knows their world.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/0b59f54a-4598-46ea-9d30-592f289e4c70",
            "alt": "Vertical-Specific Voice \u2014 Legal, Accounting, IT, Agencies"
          }
        },
        {
          "title": "Intent-Aware Reply Handling",
          "body": "When a prospect writes back, the agent reads intent \u2014 genuine interest, objection, referral, wrong contact \u2014 and responds accordingly with a contextually appropriate follow-up or a direct calendar link. You only touch the thread when a meeting is confirmed.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/ce47cbdc-c954-4e5a-ac4b-09a508af8f82",
            "alt": "Intent-Aware Reply Handling"
          }
        }
      ],
      "title": "The Capabilities That Actually Close the Gap"
    },
    {
      "type": "feature_grid",
      "features": [
        {
          "title": "Daily Prospect Sourcing",
          "body": "Pulls and verifies fresh leads from Apollo and LinkedIn every day against your ICP definition \u2014 no manual list building, no CSV uploads."
        },
        {
          "title": "Warmed Sending Infrastructure",
          "body": "Dedicated sending domains, inbox warming, and deliverability monitoring are provisioned and managed for you \u2014 your primary domain stays clean."
        },
        {
          "title": "2\u20133 Touch Sequences",
          "body": "Each prospect receives a personalized initial email plus up to two intelligent follow-up touches, spaced and timed to maximize reply rate without burning the lead."
        },
        {
          "title": "Calendar Integration",
          "body": "Confirmed meetings sync directly to Google Calendar or Outlook \u2014 no back-and-forth scheduling, no third-party booking tool required."
        },
        {
          "title": "Reply Classification",
          "body": "Every inbound reply is tagged: interested, nurture, unsubscribe, wrong person. You get a clean view of live pipeline without reading every email thread."
        },
        {
          "title": "Month-to-Month, Cancel Anytime",
          "body": "No annual contracts, no seat minimums, no overage fees. Pay $499 this month; if it's not booking meetings, cancel before the next billing date."
        }
      ],
      "title": "Everything Included at $499/mo \u2014 No Asterisks",
      "subhead": "Sending infrastructure, data sourcing, deliverability setup, and reply handling are all in the flat rate."
    },
    {
      "type": "social_proof",
      "quotes": [
        {
          "quote": "I'd been meaning to 'do outbound' for two years. Within a week of the trial I had three calls on the calendar with exactly the kind of firm I want as a client. I didn't write a single email.",
          "author": "Managing Partner",
          "role": "8-person CPA firm, Texas"
        },
        {
          "quote": "We tried hiring a part-time BDR. It was a disaster \u2014 onboarding, scripts, managing the process. This just runs. The emails sound like me, maybe better than me.",
          "author": "Founder",
          "role": "IT MSP, 12 employees, Ohio"
        },
        {
          "quote": "The trigger-event emails are what got my attention as a buyer. When I saw the personalization on the demo prospects, I converted the same day.",
          "author": "Principal",
          "role": "Boutique employment law firm, California"
        }
      ],
      "title": "What Founders Say After the First Booked Meeting"
    },
    {
      "type": "faq",
      "items": [
        {
          "q": "Will these emails actually sound like me, or will prospects know it's AI?",
          "a": "The agent writes in your firm's vertical register and anchors each email to a real trigger event at the prospect's company. Recipients consistently respond as if a founder reached out personally \u2014 because the context is specific and the language is natural, not templated."
        },
        {
          "q": "What happens during the free trial \u2014 am I committing to anything?",
          "a": "No credit card is required to start. The agent automates your first 50 prospects completely free. You only convert to a paid plan if and when a meeting is booked \u2014 most founders do so within 24 hours of that first confirmation."
        },
        {
          "q": "Will this hurt my domain's email deliverability?",
          "a": "No. The agent provisions dedicated sending domains separate from your primary domain, handles all inbox warming, and manages SPF/DKIM/DMARC records. Your main domain is never touched."
        },
        {
          "q": "What if I'm in a regulated industry like law or accounting \u2014 is the outreach compliant?",
          "a": "The agent follows CAN-SPAM rules by default: clear sender identity, physical address, and one-click unsubscribe on every email. For state bar or professional-conduct nuances, you can review and approve email templates before the agent sends."
        },
        {
          "q": "I only need 20 meetings a month \u2014 is this overkill?",
          "a": "Twenty qualified meetings a month at $499 flat is a $25 cost-per-meeting. A human SDR booking the same volume typically costs $3,000\u2013$6,000 per month all-in. The agent scales up or down based on your ICP size; you're not paying per lead or per meeting."
        }
      ],
      "title": "Real Questions From Founders Like You"
    },
    {
      "type": "cta_band",
      "headline": "Your First 50 Prospects Are Free. Your Next Client Could Be on the Calendar This Week.",
      "subhead": "No SDR hire. No annual contract. No setup fee. Start the trial, watch the agent work, and pay only when a meeting lands."
    }
  ]
};
