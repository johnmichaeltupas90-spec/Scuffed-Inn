-- HISTORICAL: applied to the original database; cannot run on a fresh database.
-- Use db/schema.sql instead.
-- 004 — payment method
-- The reservation form collects GCash / Maya / Card. Existing rows stay NULL.
-- Safe to run more than once.

ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS payment_method varchar(20);

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_payment_method_check;
ALTER TABLE reservations
    ADD CONSTRAINT reservations_payment_method_check
        CHECK (payment_method IS NULL OR payment_method IN ('GCash', 'Maya', 'Card'));
