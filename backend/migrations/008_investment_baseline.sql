-- Up Migration
-- Adds investment_baseline: household-level monthly planned investment amounts.
-- Used to compute expected total portfolio value at portfolio_allocation_target.end_date:
--   expected_total = SUM(holding.current_value)
--                  + SUM(ib.amount WHERE ib.month > today AND ib.month <= end_date)
-- No person_id — investments are managed at household level regardless of whose account.

CREATE TABLE investment_baseline (
  id     SERIAL        PRIMARY KEY,
  month  DATE          NOT NULL UNIQUE,  -- LAST day of month (e.g. 2026-06-30) — intentional deviation from first-day convention
  amount NUMERIC(18,4) NOT NULL          -- total planned household investment that month, INR
);

-- Down Migration

DROP TABLE IF EXISTS investment_baseline;
