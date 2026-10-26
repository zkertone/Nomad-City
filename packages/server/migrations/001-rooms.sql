-- A room's immutable definition and roster accompany its single authoritative game snapshot.
CREATE TABLE IF NOT EXISTS nco_rooms (
  room_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE,
  state_version BIGINT NOT NULL CHECK (state_version BETWEEN 0 AND 9007199254740991),
  definition JSONB NOT NULL,
  members JSONB NOT NULL CHECK (jsonb_typeof(members) = 'array'),
  state JSONB NOT NULL,
  CHECK (jsonb_typeof(definition) = 'object' AND jsonb_typeof(state) = 'object'),
  CHECK (jsonb_typeof(definition -> 'gameId') = 'string' AND jsonb_typeof(state -> 'gameId') = 'string'),
  CHECK (jsonb_typeof(state -> 'stateVersion') = 'number'),
  CHECK (definition ->> 'gameId' = game_id),
  CHECK (state ->> 'gameId' = game_id),
  CHECK ((state ->> 'stateVersion')::NUMERIC = state_version),
  CHECK (definition ? 'gameId' AND state ? 'gameId' AND state ? 'stateVersion')
);
