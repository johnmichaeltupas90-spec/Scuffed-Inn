-- HISTORICAL: applied to the original database; cannot run on a fresh database.
-- Use db/schema.sql instead.
-- 003 — sample rooms
-- The four existing types cover Single/Double King/Queen. This adds the "Suite"
-- from the example set, so the demo has all three tiers and 10 rooms in total.
-- Safe to run more than once.

INSERT INTO rooms (room_number, room_type, price_per_night, capacity)
VALUES
    (301, 'Suite King Bed', 3500.00, 4),
    (302, 'Suite King Bed', 3500.00, 4)
ON CONFLICT (room_number) DO NOTHING;
