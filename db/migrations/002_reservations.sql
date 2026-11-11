-- HISTORICAL: applied to the original database; cannot run on a fresh database.
-- Use db/schema.sql instead.
-- 002 — reservations
-- Rebuilds reservations around guest_id + room_id + stay dates + status.
-- RUN ONCE (it drops the old guest columns after copying them into guests).
-- All statements run in one transaction: it either fully applies or not at all.

-- 0. Keep a copy of the old table, just in case.
CREATE TABLE IF NOT EXISTS reservations_backup_20261111 AS
SELECT * FROM reservations;

-- 1. The old clients -> reservations links block both new bookings and this
--    migration. They were also backwards (a client had to exist in reservations
--    before it could be created).
ALTER TABLE clients
    DROP CONSTRAINT IF EXISTS "Clients_client_name_fkey",
    DROP CONSTRAINT IF EXISTS "Clients_email_address_fkey",
    DROP CONSTRAINT IF EXISTS "Clients_contact_number_fkey";

-- 2. New columns. reservation_number stays the primary key (it is the "id"):
--    the admin page and delete route already use that name.
ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS room_id  bigint REFERENCES rooms(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS check_in  date,
    ADD COLUMN IF NOT EXISTS check_out date,
    ADD COLUMN IF NOT EXISTS status    varchar(20) NOT NULL DEFAULT 'pending';

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations
    ADD CONSTRAINT reservations_status_check
        CHECK (status IN ('pending', 'confirmed', 'cancelled'));
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_dates_check;
ALTER TABLE reservations
    ADD CONSTRAINT reservations_dates_check
        CHECK (check_in IS NULL OR check_out IS NULL OR check_out > check_in);

CREATE INDEX IF NOT EXISTS reservations_room_stay_idx
    ON reservations (room_id, check_in, check_out);

-- 3. Copy the guest details out of the old columns into guests.
INSERT INTO guests (full_name, email, phone)
SELECT DISTINCT r.name, r.email_address, r.contact_number
FROM reservations r
WHERE r.name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM guests g
      WHERE g.full_name IS NOT DISTINCT FROM r.name
        AND g.email     IS NOT DISTINCT FROM r.email_address
  );

UPDATE reservations r
SET guest_id = g.id
FROM guests g
WHERE r.guest_id IS NULL
  AND g.full_name IS NOT DISTINCT FROM r.name
  AND g.email     IS NOT DISTINCT FROM r.email_address;

-- 4. Point each old reservation at the room its client was assigned, falling
--    back to any room of the requested type.
UPDATE reservations r
SET room_id = (
    SELECT rm.id
    FROM clients c
    JOIN rooms rm ON rm.room_number = c.assigned_room_number
    WHERE c.email_address = r.email_address
    LIMIT 1
)
WHERE r.room_id IS NULL AND r.email_address IS NOT NULL;

UPDATE reservations r
SET room_id = (SELECT min(rm.id) FROM rooms rm WHERE rm.room_type = r.room_type)
WHERE r.room_id IS NULL;

-- 5. The old rows had no stay dates. Placeholder: the day they were created,
--    for one night. Replace with the real dates if you know them.
UPDATE reservations
SET check_in  = created_at::date,
    check_out = created_at::date + 1
WHERE check_in IS NULL;

-- 6. Everything is filled in, so require it from now on.
ALTER TABLE reservations
    ALTER COLUMN guest_id  SET NOT NULL,
    ALTER COLUMN room_id   SET NOT NULL,
    ALTER COLUMN check_in  SET NOT NULL,
    ALTER COLUMN check_out SET NOT NULL;

-- 7. Drop the duplicated guest details and room type.
ALTER TABLE reservations
    DROP COLUMN IF EXISTS name,
    DROP COLUMN IF EXISTS email_address,
    DROP COLUMN IF EXISTS contact_number,
    DROP COLUMN IF EXISTS room_type;
