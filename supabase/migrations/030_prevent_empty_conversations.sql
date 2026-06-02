-- ===========================
-- PREVENT EMPTY CONVERSATIONS — Trusttec
-- ===========================
-- Conversations are now only created when the first message is sent.
-- create_conv_with_admin now requires an initial_content parameter.
-- send_chat_msg can auto-create a conversation if conv_id is NULL.

-- 1. Replace create_conv_with_admin to require initial message
DROP FUNCTION IF EXISTS public.create_conv_with_admin;

CREATE OR REPLACE FUNCTION public.create_conv_with_admin(subject text, user_id uuid, initial_content text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  new_conv_id uuid;
  admin_id uuid;
  sname text;
  savatar text;
BEGIN
  INSERT INTO public.conversations (subject)
    VALUES (subject)
    RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_conv_id, user_id);

  admin_id := public.get_admin_for_chat();
  IF admin_id IS NOT NULL AND admin_id <> user_id THEN
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
      VALUES (new_conv_id, admin_id);
  END IF;

  SELECT p.full_name, p.avatar_url INTO sname, savatar
  FROM public.profiles p WHERE p.id = user_id;

  UPDATE public.conversations
  SET last_message = initial_content, last_message_at = now()
  WHERE id = new_conv_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (new_conv_id, user_id, initial_content, COALESCE(sname, split_part((SELECT email FROM public.profiles WHERE id = user_id), '@', 1)), savatar);

  RETURN new_conv_id;
END;
$$;

-- 2. Drop old 3-param overload (returns void) and create new 4-param version (returns uuid)
DROP FUNCTION IF EXISTS public.send_chat_msg(uuid, uuid, text);
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
  conv_subject := COALESCE(subject, 'Support Trusttec');

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
