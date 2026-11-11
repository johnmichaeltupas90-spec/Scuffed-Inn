-- HISTORICAL: applied to the original database; cannot run on a fresh database.
-- Use db/schema.sql instead.
-- 001 — rooms + guests
-- Adds price/capacity to the existing rooms table and creates the guests table.
-- Safe to run more than once.

ALTER TABLE rooms
    ADD COLUMN IF NOT EXISTS price_per_night numeric(10, 2),
    ADD COLUMN IF NOT EXISTS capacity        integer;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_price_per_night_check;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_capacity_check;

ALTER TABLE rooms
    ADD CONSTRAINT rooms_price_per_night_check
        CHECK (price_per_night IS NULL OR price_per_night >= 0),
    ADD CONSTRAINT rooms_capacity_check
        CHECK (capacity IS NULL OR capacity > 0);

CREATE TABLE IF NOT EXISTS guests (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name varchar(120) NOT NULL,
    email     varchar(200),
    phone     varchar(40)
);

-- Placeholder rates so the pages have something to show. Edit freely.
UPDATE rooms SET price_per_night = 1200.00, capacity = 2
    WHERE room_type LIKE 'Single King%'  AND price_per_night IS NULL;
UPDATE rooms SET price_per_night = 1100.00, capacity = 2
    WHERE room_type LIKE 'Single Queen%' AND price_per_night IS NULL;
UPDATE rooms SET price_per_night = 1800.00, capacity = 4
    WHERE room_type LIKE 'Double King%'  AND price_per_night IS NULL;
UPDATE rooms SET price_per_night = 1600.00, capacity = 4
    WHERE room_type LIKE 'Double Queen%' AND price_per_night IS NULL;
