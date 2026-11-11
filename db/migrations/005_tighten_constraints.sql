-- HISTORICAL: applied to the original database; cannot run on a fresh database.
-- Use db/schema.sql instead.
-- 005 — tighten constraints
-- Makes the rooms columns required, removes the old NULL allowances, drops the
-- unused 'confirmed' status, adds the guest email rule, and scales money to cents.
-- Safe to run more than once.

BEGIN;

ALTER TABLE rooms
    ALTER COLUMN room_number SET NOT NULL,
    ALTER COLUMN room_type SET NOT NULL,
    ALTER COLUMN price_per_night SET NOT NULL,
    ALTER COLUMN capacity SET NOT NULL;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_price_per_night_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_price_per_night_check
    CHECK (price_per_night >= 0);

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_capacity_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_capacity_check
    CHECK (capacity > 0);

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_dates_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_dates_check
    CHECK (check_out > check_in);

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('pending', 'cancelled'));

-- Guest emails are unique (case-insensitive) when present, so the API's
-- find-or-create rule is enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS guests_email_lower_key
    ON guests (lower(email))
    WHERE email IS NOT NULL;

-- Money is exact and scaled to cents.
ALTER TABLE rooms
    ALTER COLUMN price_per_night TYPE numeric(10, 2);

-- Normalise the legacy capitalised primary-key name so a rebuilt schema matches.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'reservations'::regclass
          AND conname = 'Reservations_pkey'
    ) THEN
        ALTER TABLE reservations
            RENAME CONSTRAINT "Reservations_pkey" TO reservations_pkey;
    END IF;
END
$$;

COMMIT;
