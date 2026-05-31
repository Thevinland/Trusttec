-- ===========================
-- DELETE CONVERSATION (SOFT) -- Trusttec
-- ===========================
-- Soft delete : l'admin masque la conversation de SA vue uniquement.
-- Le client voit encore tout. Les messages sont conservés.

CREATE OR REPLACE FUNCTION public.delete_admin_conversation(conv_id uuid, admin_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = conv_id AND profile_id = admin_id
  ) THEN
    RAISE EXCEPTION 'Not a participant of this conversation';
  END IF;

  UPDATE public.conversation_participants
  SET deleted_at = now()
  WHERE conversation_id = conv_id AND profile_id = admin_id;
END;
$$;
