-- ===========================
-- FIX get_conv_messages — supprime le filtre deleted_at
-- ===========================
-- Le problème : quand un utilisateur ouvre une conversation,
-- get_conv_messages vérifie que le participant a deleted_at IS NULL.
-- Mais si la conversation a été restaurée (Alibaba) entre le chargement
-- de la liste et l'ouverture, le participant peut être deleted_at = NULL
-- OU pas. Résultat : la conversation apparaît dans la liste (chargée AVANT
-- la restauration) mais les messages sont vides (get_conv_messages vérifie
-- AU MOMENT de l'ouverture).
--
-- Solution : on supprime la vérification deleted_at IS NULL dans
-- get_conv_messages. La liste des conversations filtre déjà par
-- deleted_at IS NULL. Inutile de revérifier au chargement des messages.
-- La seule vérification nécessaire est que l'utilisateur soit participant
-- (peu importe le statut deleted_at).

DROP FUNCTION IF EXISTS public.get_conv_messages(uuid);

CREATE FUNCTION public.get_conv_messages(conv_id uuid)
RETURNS TABLE(
  id uuid, conversation_id uuid, sender_id uuid,
  content text, media_url text, created_at timestamptz,
  sender_name text, sender_avatar text
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.id, m.conversation_id, m.sender_id,
         m.content, m.media_url, m.created_at,
         COALESCE(m.sender_name, p.full_name, split_part(p.email, '@', 1), 'Inconnu'),
         COALESCE(m.sender_avatar, p.avatar_url)
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  WHERE m.conversation_id = conv_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conv_id
        AND cp.profile_id = auth.uid()
    )
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conv_messages(uuid) TO anon, authenticated, service_role;
