CREATE TABLE IF NOT EXISTS nco_lobbies (
  lobby_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  create_request_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
  snapshot JSONB NOT NULL,
  invite_hash TEXT CHECK (invite_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (owner_id, create_request_id),
  CHECK (jsonb_typeof(snapshot) = 'object' AND snapshot ?& ARRAY['lobbyId','ownerId','createRequestId','version','members','status']),
  CHECK (snapshot ->> 'lobbyId' = lobby_id AND snapshot ->> 'ownerId' = owner_id),
  CHECK (snapshot ->> 'createRequestId' = create_request_id AND (snapshot ->> 'version')::NUMERIC = version),
  CHECK (jsonb_typeof(snapshot -> 'members') = 'array'),
  CHECK (snapshot ->> 'status' IN ('waiting', 'started', 'cancelled')),
  CHECK ((snapshot ->> 'status' = 'waiting') = (invite_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nco_lobbies_members ON nco_lobbies USING GIN ((snapshot -> 'members') jsonb_path_ops);
