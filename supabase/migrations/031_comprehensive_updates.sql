-- ================================================
-- MIGRATION 031 — Comprehensive updates
-- ================================================

-- ================================================
-- 1. Churn log : enrichir la table + delete_my_account
-- ================================================
ALTER TABLE public.churn_log
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT;

CREATE OR REPLACE FUNCTION public.delete_my_account()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  uid uuid;
  v_email text;
  v_full_name text;
  v_role text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email, full_name, role INTO v_email, v_full_name, v_role
  FROM public.profiles WHERE id = uid;

  INSERT INTO public.churn_log (user_id, email, full_name, role)
  VALUES (uid, v_email, v_full_name, v_role);

  DELETE FROM public.conversation_participants WHERE profile_id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- ================================================
-- 2. Profils : ajouter updated_at et son trigger
-- ================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.update_profile_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_updated_at ON public.profiles;
CREATE TRIGGER trg_profile_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profile_timestamp();

-- ================================================
-- 3. send_chat_msg : sujet générique
-- ================================================
CREATE OR REPLACE FUNCTION public.send_chat_msg(conv_id uuid, sender_id uuid, content text, subject text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
  actual_conv_id uuid;
  admin_id uuid;
  conv_subject text;
BEGIN
  actual_conv_id := conv_id;
  conv_subject := COALESCE(subject, 'Support');

  IF actual_conv_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.conversations WHERE id = actual_conv_id
  ) THEN
    INSERT INTO public.conversations (subject)
      VALUES (conv_subject)
      RETURNING id INTO actual_conv_id;

    INSERT INTO public.conversation_participants (conversation_id, profile_id)
      VALUES (actual_conv_id, sender_id);

    admin_id := public.get_admin_for_chat();
    IF admin_id IS NOT NULL AND admin_id <> sender_id THEN
      INSERT INTO public.conversation_participants (conversation_id, profile_id)
        VALUES (actual_conv_id, admin_id);
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = actual_conv_id AND profile_id = sender_id
    ) THEN
      RAISE EXCEPTION 'Not a participant of this conversation';
    END IF;

    UPDATE public.conversation_participants
    SET deleted_at = NULL
    WHERE conversation_id = actual_conv_id;
  END IF;

  SELECT p.full_name, p.avatar_url INTO sname, savatar
  FROM public.profiles p WHERE p.id = sender_id;

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = actual_conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (actual_conv_id, sender_id, content, COALESCE(sname, split_part((SELECT email FROM public.profiles WHERE id = sender_id), '@', 1)), savatar);

  RETURN actual_conv_id;
END;
$$;

-- ================================================
-- 4. RLS activity_logs : admins peuvent aussi lire
-- ================================================
DROP POLICY IF EXISTS activity_logs_select_admin ON public.activity_logs;
CREATE POLICY activity_logs_select_admin ON public.activity_logs
  FOR SELECT
  USING (public.is_admin());

-- ================================================
-- 5. Index plein texte sur products (colonne générée + GIN)
-- ================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('french', COALESCE(name, '') || ' ' || COALESCE(description, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_products_search ON public.products USING GIN (search_vector);

-- ================================================
-- 6. Contrainte de longueur sur messages.content
-- ================================================
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_length_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_length_check
  CHECK (length(content) <= 5000);

-- ================================================
-- 7. Devise sur products
-- ================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'XAF';
