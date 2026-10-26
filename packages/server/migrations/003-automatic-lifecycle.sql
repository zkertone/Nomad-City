-- NULL preserves existing manually orchestrated rooms. Only trusted new-room provisioning opts in.
ALTER TABLE nco_rooms ADD COLUMN IF NOT EXISTS lifecycle JSONB;
