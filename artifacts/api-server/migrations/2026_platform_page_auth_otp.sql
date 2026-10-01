CREATE TABLE IF NOT EXISTS public.platform_page_auth_otp_challenges (
  id uuid PRIMARY KEY,
  admin_id bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('isp_admin', 'reseller')),
  feature text NOT NULL,
  method text NOT NULL CHECK (method IN ('whatsapp', 'sms', 'email')),
  session_hash text NOT NULL CHECK (length(session_hash) = 64),
  code_hash text NOT NULL CHECK (length(code_hash) = 64),
  request_ip inet,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  verified_at timestamptz,
  invalidated_at timestamptz
);

CREATE INDEX IF NOT EXISTS platform_page_auth_otp_admin_created_idx
  ON public.platform_page_auth_otp_challenges (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_page_auth_otp_ip_created_idx
  ON public.platform_page_auth_otp_challenges (request_ip, created_at DESC)
  WHERE request_ip IS NOT NULL;

ALTER TABLE public.platform_page_auth_otp_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_page_auth_otp_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_page_auth_otp_challenges TO service_role;

CREATE OR REPLACE FUNCTION public.issue_platform_page_auth_otp(
  p_id uuid,
  p_admin_id bigint,
  p_role text,
  p_feature text,
  p_method text,
  p_session_hash text,
  p_code_hash text,
  p_request_ip inet
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_account_count integer;
  v_ip_count integer;
BEGIN
  IF p_admin_id <= 0
     OR p_role NOT IN ('isp_admin', 'reseller')
     OR p_method NOT IN ('whatsapp', 'sms', 'email')
     OR length(coalesce(p_session_hash, '')) <> 64
     OR length(coalesce(p_code_hash, '')) <> 64
     OR coalesce(p_feature, '') = '' THEN
    RETURN 'invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('page-auth-admin:' || p_admin_id::text));
  IF p_request_ip IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('page-auth-ip:' || p_request_ip::text));
  END IF;

  DELETE FROM public.platform_page_auth_otp_challenges
   WHERE created_at < v_now - interval '7 days';

  IF EXISTS (
    SELECT 1
      FROM public.platform_page_auth_otp_challenges
     WHERE admin_id = p_admin_id
       AND created_at > v_now - interval '60 seconds'
  ) THEN
    RETURN 'cooldown';
  END IF;

  SELECT count(*) INTO v_account_count
    FROM public.platform_page_auth_otp_challenges
   WHERE admin_id = p_admin_id
     AND created_at > v_now - interval '1 hour';
  IF v_account_count >= 6 THEN
    RETURN 'rate_limited';
  END IF;

  IF p_request_ip IS NOT NULL THEN
    SELECT count(*) INTO v_ip_count
      FROM public.platform_page_auth_otp_challenges
     WHERE request_ip = p_request_ip
       AND created_at > v_now - interval '1 hour';
    IF v_ip_count >= 30 THEN
      RETURN 'rate_limited';
    END IF;
  END IF;

  UPDATE public.platform_page_auth_otp_challenges
     SET invalidated_at = v_now
   WHERE admin_id = p_admin_id
     AND session_hash = p_session_hash
     AND feature = p_feature
     AND method = p_method
     AND verified_at IS NULL
     AND invalidated_at IS NULL;

  INSERT INTO public.platform_page_auth_otp_challenges (
    id, admin_id, role, feature, method, session_hash, code_hash,
    request_ip, created_at, expires_at
  ) VALUES (
    p_id, p_admin_id, p_role, p_feature, p_method, p_session_hash, p_code_hash,
    p_request_ip, v_now, v_now + interval '5 minutes'
  );
  RETURN 'issued';
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_platform_page_auth_otp(
  p_id uuid,
  p_admin_id bigint,
  p_role text,
  p_feature text,
  p_method text,
  p_session_hash text,
  p_code_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_challenge public.platform_page_auth_otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_challenge
    FROM public.platform_page_auth_otp_challenges
   WHERE id = p_id
     AND admin_id = p_admin_id
     AND role = p_role
     AND feature = p_feature
     AND method = p_method
     AND session_hash = p_session_hash
   FOR UPDATE;

  IF NOT FOUND
     OR v_challenge.verified_at IS NOT NULL
     OR v_challenge.invalidated_at IS NOT NULL
     OR v_challenge.expires_at <= now()
     OR v_challenge.attempts >= 5 THEN
    RETURN 'invalid';
  END IF;

  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE public.platform_page_auth_otp_challenges
       SET attempts = attempts + 1,
           invalidated_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE invalidated_at END
     WHERE id = p_id;
    RETURN 'invalid';
  END IF;

  UPDATE public.platform_page_auth_otp_challenges
     SET verified_at = now()
   WHERE id = p_id;
  RETURN 'verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_platform_page_auth_otp(
  p_id uuid,
  p_admin_id bigint,
  p_session_hash text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.platform_page_auth_otp_challenges
     SET invalidated_at = now()
   WHERE id = p_id
     AND admin_id = p_admin_id
     AND session_hash = p_session_hash
     AND verified_at IS NULL
     AND invalidated_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.issue_platform_page_auth_otp(
  uuid, bigint, text, text, text, text, text, inet
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_platform_page_auth_otp(
  uuid, bigint, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_platform_page_auth_otp(
  uuid, bigint, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_platform_page_auth_otp(
  uuid, bigint, text, text, text, text, text, inet
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_platform_page_auth_otp(
  uuid, bigint, text, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_platform_page_auth_otp(
  uuid, bigint, text
) TO service_role;