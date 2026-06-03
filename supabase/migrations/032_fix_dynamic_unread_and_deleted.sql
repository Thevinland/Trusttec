-- ================================================
-- MIGRATION 032 — Dynamic unread + fix deleted_at restore
-- ================================================

-- ================================================
-- 1. get_admin_total_unread : calcul dynamique via messages/last_read_at
-- ================================================
CREATE OR REPLACE FUNCTION public.get_admin_total_unread()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(SUM(sub.cnt), 0)::bigint
  FROM (
    SELECT COUNT(m.id) AS cnt
    FROM public.conversation_participants cp
    LEFT JOIN public.messages m
      ON m.conversation_id = cp.conversation_id
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
      AND m.sender_id <> cp.profile_id
    WHERE cp.profile_id IN (
      SELECT id FROM public.profiles
      WHERE role IN ('admin', 'super_admin')
        AND deleted_at IS NULL
    )
      AND cp.deleted_at IS NULL
    GROUP BY cp.conversation_id, cp.profile_id
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_total_unread() TO anon, authenticated, service_role;

-- ================================================
-- 2. increment_unread_safe : fonction orpheline, supprimée
-- ================================================
DROP FUNCTION IF EXISTS public.increment_unread_safe(uuid, uuid);

-- ================================================
-- 3. send_chat_msg : ne plus restaurer deleted_at pour les autres
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
-- 4. send_admin_msg : supprimer aussi la restauration si elle existe
-- ================================================
CREATE OR REPLACE FUNCTION public.send_admin_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname   text;
  savatar text;
BEGIN
  SET LOCAL lock_timeout = '5000ms';

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = sender_id AND role IN ('admin', 'super_admin')) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id AND profile_id = sender_id
  ) THEN
    RAISE EXCEPTION 'Not a participant of this conversation';
  END IF;

  SELECT p.full_name, p.avatar_url INTO sname, savatar
    FROM public.profiles p WHERE p.id = sender_id;

  UPDATE public.conversations
     SET last_message = content, last_message_at = now()
   WHERE id = conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content, COALESCE(sname, 'Admin'), savatar);
END;
$$;
