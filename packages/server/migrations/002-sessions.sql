CREATE TABLE IF NOT EXISTS nco_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS nco_sessions_expiry ON nco_sessions (expires_at);
