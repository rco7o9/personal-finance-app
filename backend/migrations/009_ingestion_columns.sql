-- Up Migration
-- Adds three nullable columns to investment_transaction and expense to support
-- AI-parsed statement ingestion (Phase 3b). All columns are nullable so that
-- existing manually-entered confirmed rows are unaffected.
--
-- confidence_score: 0.0–1.0; deterministic parsers always emit 1.0; null for manual rows
-- verification_status: outcome of the arithmetic balance check in the agent verifier
-- raw_source: full verbatim row object returned by the agent (source_text + full parsed row)
--
-- No enum change needed: the existing 'pending' value in transaction_status is used
-- for AI-parsed rows awaiting human review.

ALTER TABLE investment_transaction
  ADD COLUMN confidence_score    NUMERIC(5,4),
  ADD COLUMN verification_status TEXT
    CHECK (verification_status IN ('passed', 'failed', 'skipped')),
  ADD COLUMN raw_source          JSONB;

ALTER TABLE expense
  ADD COLUMN confidence_score    NUMERIC(5,4),
  ADD COLUMN verification_status TEXT
    CHECK (verification_status IN ('passed', 'failed', 'skipped')),
  ADD COLUMN raw_source          JSONB;

-- Down Migration

ALTER TABLE investment_transaction
  DROP COLUMN IF EXISTS confidence_score,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS raw_source;

ALTER TABLE expense
  DROP COLUMN IF EXISTS confidence_score,
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS raw_source;
