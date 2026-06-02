CREATE OR REPLACE FUNCTION public.get_admin_total_unread()
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(SUM(cnt), 0)::bigint
  FROM (
    SELECT COUNT(m.id) AS cnt
    FROM public.conversation_participants cp
    JOIN public.profiles p ON p.id = cp.profile_id
    LEFT JOIN public.messages m
      ON m.conversation_id = cp.conversation_id
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    WHERE p.role IN ('admin', 'super_admin')
      AND p.deleted_at IS NULL
      AND cp.deleted_at IS NULL
    GROUP BY cp.profile_id, cp.conversation_id
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_total_unread() TO anon, authenticated, service_role;