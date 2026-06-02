-- ===========================
-- FIX POSTGREST TIMEOUT — Trusttec
-- Ajout de SET LOCAL lock_timeout dans les fonctions d'envoi
-- pour éviter que PostgREST ne tue la requête après 30s d'attente de lock
-- ===========================

CREATE OR REPLACE FUNCTION public.send_chat_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
  SET LOCAL lock_timeout = '5000ms';

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id AND profile_id = sender_id
  ) THEN
    RAISE EXCEPTION 'Not a participant of this conversation';
  END IF;

  SELECT p.full_name, p.avatar_url INTO sname, savatar
  FROM public.profiles p WHERE p.id = sender_id;

  UPDATE public.conversation_participants
  SET deleted_at = NULL
  WHERE conversation_id = conv_id;

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content, sname, savatar);
END;
$$;

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

-- Vérifier les indexes existants sur les colonnes chaudes
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_participants_profile ON public.conversation_participants (profile_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON public.conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_active ON public.conversation_participants (profile_id, conversation_id) WHERE deleted_at IS NULL;