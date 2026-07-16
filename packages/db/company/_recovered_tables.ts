/**
 * AUTO-RECOVERED table DDL (table-ref-autorecover-001).
 *
 * The integration table-ref gate found these tables queried by apps/web
 * with no creating DDL. Columns are inferred from the SQL the build agents
 * wrote (best-effort, loosely typed) so migrate.ts creates them at deploy
 * and the runtime queries don't 500. Reviewable + replaceable: if a feature
 * later adds a richer hand-written DDL for one of these tables, delete its
 * block here (CREATE TABLE IF NOT EXISTS would otherwise no-op the richer one).
 */

export const RECOVERED_SDR_SUPPRESSION_LIST_DDL = `
CREATE TABLE IF NOT EXISTS sdr_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text,
  "org_id" uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
