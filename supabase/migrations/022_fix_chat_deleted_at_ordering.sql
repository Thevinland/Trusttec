-- Fix #1: send_chat_msg — restore deleted_at BEFORE INSERT pour Realtime
-- et pour TOUS les participants (y compris l'expéditeur)
CREATE OR REPLACE FUNCTION public.send_chat_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id AND profile_id = sender_id
  ) THEN
    RAISE EXCEPTION 'Not a participant of this conversation';
  END IF;

  SELECT p.full_name, p.avatar_url INTO sname, savatar
  FROM public.profiles p WHERE p.id = sender_id;

  -- Restaurer deleted_at = NULL pour TOUS les participants AVANT l'INSERT
  -- → Realtime peut livrer l'événement (RLS vérifie deleted_at IS NULL)
  UPDATE public.conversation_participants
  SET deleted_at = NULL
  WHERE conversation_id = conv_id;

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content, sname, savatar);

  UPDATE public.conversation_participants
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE conversation_id = conv_id AND profile_id != sender_id;
END;
$$;

-- Fix #2: send_admin_msg — restore deleted_at BEFORE INSERT pour Realtime
-- et pour TOUS les participants (y compris l'expéditeur)
CREATE OR REPLACE FUNCTION public.send_admin_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
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

  -- Restaurer deleted_at = NULL pour TOUS les participants AVANT l'INSERT
  -- → Realtime peut livrer l'événement (RLS vérifie deleted_at IS NULL)
  UPDATE public.conversation_participants
  SET deleted_at = NULL
  WHERE conversation_id = conv_id;

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content,
    COALESCE(sname, 'Admin'),
    savatar);

  UPDATE public.conversation_participants
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE conversation_id = conv_id AND profile_id != sender_id;
END;
$$;
