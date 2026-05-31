-- ===========================
-- DELETE ALL USER CONVERSATIONS -- Trusttec
-- ===========================
-- Soft-delete (masquer) toutes les conversations pour un utilisateur donné.
-- Équivalent à appeler delete_user_conversation pour chaque conversation,
-- mais en une seule requête.

CREATE OR REPLACE FUNCTION public.delete_all_user_conversations(user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversation_participants
  SET deleted_at = now()
  WHERE profile_id = user_id
    AND deleted_at IS NULL;
END;
$$;
