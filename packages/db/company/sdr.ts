/**
 * SDR domain table definitions.
 * Picked up by packages/db/migrate.ts via the SDR_DDL constant.
 */

export const SDR_DDL = `
CREATE TABLE IF NOT EXISTS sdr_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  vertical text NOT NULL,
  geography text NOT NULL,
  firm_size_min integer NOT NULL DEFAULT 1,
  firm_size_max integer NOT NULL DEFAULT 15,
  revenue_band text NOT NULL,
  sending_window_days jsonb NOT NULL DEFAULT '["monday","tuesday","wednesday","thursday","friday"]'::jsonb,
  sending_window_start text NOT NULL DEFAULT '09:00',
  sending_window_end text NOT NULL DEFAULT '17:00',
  tone text NOT NULL DEFAULT 'professional',
  template_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_campaigns_org_id
  ON sdr_campaigns (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_campaigns_created_at
  ON sdr_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS sdr_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  campaign_id uuid NOT NULL,
  full_name text NOT NULL,
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  email_verification_status text NOT NULL DEFAULT 'unverified',
  email_verification_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  title text,
  company text NOT NULL,
  company_domain text,
  linkedin_url text,
  location text,
  employee_count integer,
  revenue_estimate text,
  source text NOT NULL DEFAULT 'apollo',
  apollo_contact_id text,
  proxycurl_profile_id text,
  enrichment_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_enriched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_prospects_org_id
  ON sdr_prospects (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_prospects_campaign_id
  ON sdr_prospects (campaign_id);
CREATE INDEX IF NOT EXISTS idx_sdr_prospects_email
  ON sdr_prospects (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_prospects_org_apollo
  ON sdr_prospects (org_id, apollo_contact_id)
  WHERE apollo_contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sdr_prospect_trigger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  prospect_id uuid NOT NULL,
  event_type text NOT NULL,
  event_title text NOT NULL,
  event_description text,
  event_date timestamptz,
  relevance_score numeric(5,2) NOT NULL DEFAULT 0,
  source_url text,
  is_top_trigger boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_trigger_events_prospect
  ON sdr_prospect_trigger_events (prospect_id);
CREATE INDEX IF NOT EXISTS idx_sdr_trigger_events_org_top
  ON sdr_prospect_trigger_events (org_id, is_top_trigger);

CREATE TABLE IF NOT EXISTS sdr_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  email text NOT NULL,
  reason text NOT NULL DEFAULT 'unsubscribed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_suppressions_org_email
  ON sdr_suppressions (org_id, email);
CREATE INDEX IF NOT EXISTS idx_sdr_suppressions_org_id
  ON sdr_suppressions (org_id);

CREATE TABLE IF NOT EXISTS sdr_email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  campaign_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  trigger_event_id uuid,
  template_version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_sequences_prospect_campaign
  ON sdr_email_sequences (prospect_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_sdr_sequences_org_id
  ON sdr_email_sequences (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_sequences_campaign_id
  ON sdr_email_sequences (campaign_id);

CREATE TABLE IF NOT EXISTS sdr_sequence_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  sequence_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  touch_number integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  template_version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'queued',
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  sendgrid_message_id text,
  reply_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_sequence_id
  ON sdr_sequence_touches (sequence_id);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_org_status
  ON sdr_sequence_touches (org_id, status);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_scheduled
  ON sdr_sequence_touches (scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_prospect_id
  ON sdr_sequence_touches (prospect_id);

CREATE TABLE IF NOT EXISTS sdr_reply_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  touch_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  raw_reply text NOT NULL,
  classifier_label text NOT NULL,
  classifier_confidence numeric(4,3) NOT NULL DEFAULT 0,
  classifier_reasoning text,
  founder_override_label text,
  founder_override_reason text,
  effective_label text NOT NULL,
  escalation_status text NOT NULL DEFAULT 'none',
  escalation_notified_at timestamptz,
  draft_follow_up text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_reply_labels_touch_org
  ON sdr_reply_labels (touch_id, org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_reply_labels_org_id
  ON sdr_reply_labels (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_reply_labels_prospect_id
  ON sdr_reply_labels (prospect_id);
CREATE INDEX IF NOT EXISTS idx_sdr_reply_labels_escalation
  ON sdr_reply_labels (org_id, escalation_status)
  WHERE escalation_status != 'none';

CREATE TABLE IF NOT EXISTS sdr_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  prospect_id uuid NOT NULL,
  reply_label_id uuid,
  title text NOT NULL,
  description text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  calendar_event_id text,
  calendar_link text,
  booking_link text,
  meeting_status text NOT NULL DEFAULT 'scheduled',
  attendee_email text,
  agenda text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_meetings_org_id
  ON sdr_meetings (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_meetings_prospect_id
  ON sdr_meetings (prospect_id);
CREATE INDEX IF NOT EXISTS idx_sdr_meetings_start_at
  ON sdr_meetings (org_id, start_at);
CREATE INDEX IF NOT EXISTS idx_sdr_meetings_reply_label
  ON sdr_meetings (reply_label_id)
  WHERE reply_label_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sdr_research_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  meeting_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  firm_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_trigger_event_id uuid,
  conversation_summary text,
  talking_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sdr_research_briefs_meeting
  ON sdr_research_briefs (meeting_id);
CREATE INDEX IF NOT EXISTS idx_sdr_research_briefs_org_id
  ON sdr_research_briefs (org_id);
CREATE INDEX IF NOT EXISTS idx_sdr_research_briefs_prospect_id
  ON sdr_research_briefs (prospect_id);
`;
