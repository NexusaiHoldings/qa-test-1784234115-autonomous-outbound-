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
`;
