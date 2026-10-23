/*
# Create profiles, audit_logs tables and usage enforcement RPC

## Purpose
This migration sets up the database layer for the freemium subscription system.
It creates user profiles (with plan and subscription info), an audit log table
for tracking successful audits, and an atomic RPC function that checks whether
a user can perform an audit and logs it in a single transaction — preventing
concurrent requests from bypassing the free limit.

## Tables

### profiles
- `id` (uuid, PK, references auth.users) — one row per user
- `email` (text) — denormalized for convenience
- `plan` (text, default 'free') — 'free' or 'pro'
- `subscription_status` (text, default 'inactive') — 'active', 'inactive', 'canceled', 'past_due'
- `stripe_customer_id` (text, nullable) — Stripe customer ID
- `stripe_subscription_id` (text, nullable) — Stripe subscription ID
- `current_period_end` (timestamptz, nullable) — when the current billing period ends
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### audit_logs
- `id` (uuid, PK)
- `user_id` (uuid, references auth.users)
- `target` (text) — URL or filename audited
- `method` (text) — 'url' or 'file'
- `created_at` (timestamptz)

## RPC Functions

### can_user_audit()
SECURITY DEFINER function that atomically checks if a user can perform an audit.
For free users: checks count of audit_logs in the current calendar month; if
under 10, inserts a new log row and returns success. For pro users: always
returns success and inserts a log row. Uses SELECT ... FOR UPDATE on the profile
row to prevent concurrent bypass. Returns json with allowed (bool), remaining
(int), plan (text), and reason (text).

### get_user_usage()
SECURITY DEFINER function that returns the user's current plan and remaining
free audits for the current month without incrementing the count.

## Security
- RLS enabled on both tables
- profiles: users can read their own row only; all writes go through SECURITY
  DEFINER functions (service role updates via webhooks)
- audit_logs: users can read their own logs; inserts only through RPC
- SECURITY DEFINER functions revoke EXECUTE from PUBLIC/anon, grant to
  authenticated only
*/

-- =====================
-- profiles table
-- =====================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  subscription_status text NOT NULL DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'canceled', 'past_due')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON profiles TO authenticated;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- =====================
-- audit_logs table
-- =====================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target text NOT NULL,
  method text NOT NULL CHECK (method IN ('url', 'file')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON audit_logs TO authenticated;

DROP POLICY IF EXISTS "select_own_audit_logs" ON audit_logs;
CREATE POLICY "select_own_audit_logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for counting monthly usage
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id, created_at);

-- =====================
-- can_user_audit RPC
-- =====================
-- Atomically checks limit and logs the audit in one transaction.
-- Uses FOR UPDATE lock on profile row to prevent concurrent bypass.
CREATE OR REPLACE FUNCTION can_user_audit(a_target text, a_method text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_monthly_count int;
  v_free_limit int := 10;
  v_remaining int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'plan', 'unknown', 'reason', 'Not authenticated');
  END IF;

  -- Lock the profile row to prevent concurrent bypass
  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'remaining', 0, 'plan', 'unknown', 'reason', 'Profile not found');
  END IF;

  -- Count audits this calendar month
  SELECT count(*) INTO v_monthly_count
  FROM audit_logs
  WHERE user_id = v_user_id
    AND created_at >= date_trunc('month', now());

  IF v_profile.plan = 'pro' AND v_profile.subscription_status = 'active' THEN
    -- Pro users: unlimited, but still log the audit
    INSERT INTO audit_logs (user_id, target, method) VALUES (v_user_id, a_target, a_method);
    RETURN json_build_object('allowed', true, 'remaining', -1, 'plan', 'pro', 'reason', 'Pro plan active');
  END IF;

  -- Free user: check limit
  IF v_monthly_count >= v_free_limit THEN
    v_remaining := 0;
    RETURN json_build_object('allowed', false, 'remaining', 0, 'plan', 'free', 'reason', 'Free limit reached');
  END IF;

  -- Insert the audit log (this is the atomic increment)
  INSERT INTO audit_logs (user_id, target, method) VALUES (v_user_id, a_target, a_method);

  v_remaining := v_free_limit - v_monthly_count - 1;
  RETURN json_build_object('allowed', true, 'remaining', v_remaining, 'plan', 'free', 'reason', 'Within free limit');
END;
$$;

REVOKE EXECUTE ON FUNCTION can_user_audit(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_user_audit(text, text) TO authenticated;

-- =====================
-- get_user_usage RPC
-- =====================
-- Returns plan and remaining audits without incrementing.
CREATE OR REPLACE FUNCTION get_user_usage()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_monthly_count int;
  v_free_limit int := 10;
  v_remaining int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('plan', 'unknown', 'remaining', 0, 'subscription_status', 'inactive', 'reason', 'Not authenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('plan', 'unknown', 'remaining', 0, 'subscription_status', 'inactive', 'reason', 'Profile not found');
  END IF;

  SELECT count(*) INTO v_monthly_count
  FROM audit_logs
  WHERE user_id = v_user_id
    AND created_at >= date_trunc('month', now());

  IF v_profile.plan = 'pro' AND v_profile.subscription_status = 'active' THEN
    RETURN json_build_object('plan', 'pro', 'remaining', -1, 'subscription_status', v_profile.subscription_status, 'reason', 'Pro plan active');
  END IF;

  v_remaining := GREATEST(v_free_limit - v_monthly_count, 0);
  RETURN json_build_object('plan', 'free', 'remaining', v_remaining, 'subscription_status', v_profile.subscription_status, 'reason', 'Within free limit');
END;
$$;

REVOKE EXECUTE ON FUNCTION get_user_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_usage() TO authenticated;

-- =====================
-- handle_new_user trigger
-- =====================
-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Grant service_role access for webhook-driven updates
GRANT SELECT, UPDATE ON profiles TO service_role;
GRANT INSERT ON audit_logs TO service_role;
