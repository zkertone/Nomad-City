-- Existing immutable rosters support membership-filtered discovery without exposing public rooms.
CREATE INDEX IF NOT EXISTS nco_rooms_members ON nco_rooms USING GIN (members jsonb_path_ops);
