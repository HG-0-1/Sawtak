CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE voting_mode AS ENUM ('AUTO', 'FORCE_OPEN', 'FORCE_CLOSED', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE otp_status AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE display_kind AS ENUM ('RESULTS', 'QR', 'BOTH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE, password_hash text NOT NULL,
  role admin_role NOT NULL DEFAULT 'ADMIN', failed_attempts int NOT NULL DEFAULT 0, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash bytea PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  mfa_passed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ip_hash bytea, ua_hash bytea
);
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_by uuid REFERENCES admins(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voting_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL, mode voting_mode NOT NULL DEFAULT 'AUTO',
  opens_at timestamptz, closes_at timestamptz, is_current boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_round ON voting_rounds ((true)) WHERE is_current;
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name_en text NOT NULL, name_ar text,
  description_en text, description_ar text, sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exhibitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, name_ar text, description text, description_ar text,
  booth_label text, image_key text, thumb_key text, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exhibitors_name_key ON exhibitors(name);
CREATE TABLE IF NOT EXISTS exhibitor_categories (
  exhibitor_id uuid NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, PRIMARY KEY (exhibitor_id, category_id)
);
CREATE TABLE IF NOT EXISTS visitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, phone_enc bytea, phone_hash bytea NOT NULL UNIQUE,
  phone_last4 text NOT NULL, consent_version text NOT NULL, consent_at timestamptz NOT NULL, phone_verified_at timestamptz NOT NULL,
  device_hash bytea, blocked_at timestamptz, blocked_reason text, created_at timestamptz NOT NULL DEFAULT now(), anonymized_at timestamptz
);
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id_hash bytea PRIMARY KEY, visitor_id uuid NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ip_hash bytea, ua_hash bytea
);
CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), phone_hash bytea NOT NULL, phone_enc bytea, pending_name text NOT NULL,
  consent_version text NOT NULL, code_hash bytea NOT NULL, status otp_status NOT NULL DEFAULT 'PENDING', attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5, send_count int NOT NULL DEFAULT 1, last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, presence_sid text, ip_hash bytea, device_hash bytea, provider text, provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS otp_by_phone_time ON otp_challenges(phone_hash, created_at DESC);
CREATE TABLE IF NOT EXISTS otp_send_events (
  id bigserial PRIMARY KEY, phone_hash bytea NOT NULL,
  challenge_id uuid NOT NULL REFERENCES otp_challenges(id) ON DELETE CASCADE,
  send_number int NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, send_number)
);
CREATE INDEX IF NOT EXISTS otp_send_events_by_phone_time ON otp_send_events(phone_hash, sent_at DESC);
INSERT INTO otp_send_events(phone_hash, challenge_id, send_number, sent_at)
SELECT phone_hash, id, sends.number,
       CASE WHEN sends.number = 1 THEN created_at ELSE last_sent_at END
FROM otp_challenges
CROSS JOIN LATERAL generate_series(1, GREATEST(send_count, 1)) AS sends(number)
ON CONFLICT (challenge_id, send_number) DO NOTHING;
CREATE TABLE IF NOT EXISTS presence_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id text NOT NULL, window_index bigint NOT NULL,
  ip_hash bytea, redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS display_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash bytea NOT NULL UNIQUE, label text NOT NULL,
  kind display_kind NOT NULL DEFAULT 'BOTH', revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS display_sessions (
  id_hash bytea PRIMARY KEY, kind display_kind NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), round_id uuid NOT NULL REFERENCES voting_rounds(id),
  visitor_id uuid NOT NULL REFERENCES visitors(id), category_id uuid NOT NULL, exhibitor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), signals jsonb NOT NULL DEFAULT '{}', ip_hash bytea, device_hash bytea,
  CONSTRAINT one_vote_per_category UNIQUE (round_id, visitor_id, category_id),
  CONSTRAINT exhibitor_in_category FOREIGN KEY (exhibitor_id, category_id) REFERENCES exhibitor_categories(exhibitor_id, category_id)
);
CREATE INDEX IF NOT EXISTS votes_tally ON votes(round_id, category_id, exhibitor_id);
CREATE TABLE IF NOT EXISTS vote_voids (vote_id uuid PRIMARY KEY REFERENCES votes(id), admin_id uuid NOT NULL REFERENCES admins(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, admin_id uuid REFERENCES admins(id), action text NOT NULL, target_type text, target_id text,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_vote_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'votes are append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS votes_append_only ON votes;
CREATE TRIGGER votes_append_only BEFORE UPDATE OR DELETE ON votes FOR EACH ROW EXECUTE FUNCTION prevent_vote_mutation();
