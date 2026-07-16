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
  touch_number integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  template_version text NOT NULL DEFAULT '1.0',
  status text NOT NULL DEFAULT 'queued',
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  sendgrid_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_sequence_id
  ON sdr_sequence_touches (sequence_id);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_org_status
  ON sdr_sequence_touches (org_id, status);
CREATE INDEX IF NOT EXISTS idx_sdr_touches_scheduled
  ON sdr_sequence_touches (scheduled_at, status);
`;
