-- =====================================================
-- CORRECTIONS URGENTES + CHAMPS MANQUANTS — Trusttec
-- Exécuter dans l'éditeur SQL Supabase (pas via CLI)
-- =====================================================

-- =====================================================
-- ÉTAPE 1.1 — Churn log + hard delete
-- =====================================================

CREATE TABLE IF NOT EXISTS public.churn_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deleted_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_log_deleted_at
  ON public.churn_log (deleted_at);

ALTER TABLE public.churn_log ENABLE ROW LEVEL SECURITY;

-- Supprimer l'ancienne version si elle existe encore
DROP FUNCTION IF EXISTS public.delete_my_account();

CREATE OR REPLACE FUNCTION public.delete_my_account()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Logger le churn avant suppression (aucune donnée personnelle)
  INSERT INTO public.churn_log DEFAULT VALUES;

  -- Supprimer les participations aux conversations
  DELETE FROM public.conversation_participants
    WHERE profile_id = uid;

  -- Hard delete via CASCADE (profiles id REFERENCES auth.users ON DELETE CASCADE)
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- =====================================================
-- ÉTAPE 1.1.b — Mettre à jour les fonctions qui lisent profiles
-- =====================================================

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
AS $$
  SELECT COALESCE(role, 'customer')
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.create_conv_with_admin(subject text, user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  new_conv_id uuid;
  admin_profile RECORD;
BEGIN
  INSERT INTO public.conversations (subject)
    VALUES (subject)
    RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_conv_id, user_id);

  FOR admin_profile IN
    SELECT id FROM public.profiles
    WHERE role IN ('admin', 'super_admin')
      AND deleted_at IS NULL
  LOOP
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
      VALUES (new_conv_id, admin_profile.id);
  END LOOP;

  RETURN new_conv_id;
END;
$$;

-- =====================================================
-- ÉTAPE 2.3 — Index manquants
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles(role)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON public.profiles(created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON public.messages(sender_id, created_at DESC);

-- =====================================================
-- ÉTAPE 1.2 — get_admin_for_chat() distribué
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_admin_for_chat()
  RETURNS uuid
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO ''
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.role IN ('admin', 'super_admin')
    AND p.deleted_at IS NULL
  ORDER BY p.last_seen_at DESC NULLS LAST
  LIMIT 1;
$$;

-- =====================================================
-- ÉTAPE 2.1.a — last_seen_at dans profiles
-- =====================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen
  ON public.profiles(last_seen_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- =====================================================
-- ÉTAPE 2.2.a — last_login_at dans profiles
-- =====================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT NULL;

-- =====================================================
-- ÉTAPE 1.3.a — last_read_at + mark_conversation_read()
-- =====================================================

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT now();

UPDATE public.conversation_participants
  SET last_read_at = COALESCE(joined_at, now())
  WHERE last_read_at IS NULL;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conv_id   uuid,
  p_profile_id uuid
)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  UPDATE public.conversation_participants
    SET last_read_at  = now(),
        unread_count  = 0
    WHERE conversation_id = p_conv_id
      AND profile_id      = p_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid)
  TO anon, authenticated, service_role;

-- Vérification finale
SELECT 'Migration 017 exécutée avec succès.' AS status;
