-- Fixed-window counters for unauthenticated endpoints. Kept in Postgres so limits hold
-- across processes (several Cloudflare Worker isolates, or several Node replicas).
CREATE TABLE rate_limits (
  key           text PRIMARY KEY,
  window_start  timestamptz NOT NULL,
  hits          integer NOT NULL
);
