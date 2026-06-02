-- ===========================
-- FIX: get_conv_messages retourne l'ordre ASC
-- La sous-requête DESC + inversion finale préserve la pagination
-- ===========================

DROP FUNCTION IF EXISTS public.get_conv_messages(uuid, timestamptz, int);

CREATE FUNCTION public.get_conv_messages(
  conv_id uuid,
  cursor timestamptz DEFAULT NULL,
  page_size int DEFAULT 50
)
RETURNS TABLE(
  id uuid, conversation_id uuid, sender_id uuid,
  content text, media_url text, created_at timestamptz,
  sender_name text, sender_avatar text
)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT sub.id, sub.conversation_id, sub.sender_id,
         sub.content, sub.media_url, sub.created_at,
         sub.sender_name, sub.sender_avatar
  FROM (
    SELECT m.id, m.conversation_id, m.sender_id,
           m.content, m.media_url, m.created_at,
           COALESCE(m.sender_name, p.full_name, split_part(p.email, '@', 1), 'Inconnu') AS sender_name,
           COALESCE(m.sender_avatar, p.avatar_url) AS sender_avatar
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    WHERE m.conversation_id = conv_id
      AND (cursor IS NULL OR m.created_at < cursor)
      AND EXISTS (
        SELECT 1 FROM public.conversation_participants cp
        WHERE cp.conversation_id = conv_id
          AND cp.profile_id = auth.uid()
      )
    ORDER BY m.created_at DESC
    LIMIT page_size
  ) sub
  ORDER BY sub.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conv_messages(uuid, timestamptz, int) TO anon, authenticated, service_role;