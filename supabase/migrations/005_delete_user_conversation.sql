-- ===========================
-- DELETE USER CONVERSATION -- Trusttec
-- ===========================
-- Permet à un utilisateur de supprimer complètement une conversation
-- (messages + participants + conversation) depuis le frontend

CREATE OR REPLACE FUNCTION public.delete_user_conversation(conv_id uuid, user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id AND profile_id = user_id
  ) THEN
    RAISE EXCEPTION 'Not a participant of this conversation';
  END IF;

  DELETE FROM public.messages WHERE conversation_id = conv_id;
  DELETE FROM public.conversation_participants WHERE conversation_id = conv_id;
  DELETE FROM public.conversations WHERE id = conv_id;
END;
$$;
