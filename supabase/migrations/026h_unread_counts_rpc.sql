CREATE OR REPLACE FUNCTION public.get_conversation_unread_counts(p_profile_id uuid)
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT cp.conversation_id, COUNT(m.id)::bigint
  FROM public.conversation_participants cp
  LEFT JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
    AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
  WHERE cp.profile_id = p_profile_id
    AND cp.profile_id = auth.uid()
    AND cp.deleted_at IS NULL
  GROUP BY cp.conversation_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_unread_counts(uuid) TO anon, authenticated, service_role;