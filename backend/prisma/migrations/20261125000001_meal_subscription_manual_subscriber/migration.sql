ALTER TABLE meal_subscriptions
  ALTER COLUMN resident_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS subscriber_name TEXT;
