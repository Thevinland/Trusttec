-- ===========================
-- OPTIMISATION CHAT -- Trusttec
-- ===========================

-- 1. RPC batch : participants pour plusieurs conversations (élimine N+1)
CREATE OR REPLACE FUNCTION public.get_batch_conv_participants(conv_ids uuid[], my_id uuid)
RETURNS TABLE(conv_id uuid, profile_id uuid, full_name text, email text, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT cp.conversation_id, cp.profile_id, p.full_name, p.email, p.role
  FROM public.conversation_participants cp
  LEFT JOIN public.profiles p ON p.id = cp.profile_id
  WHERE cp.conversation_id = ANY(conv_ids)
    AND cp.profile_id != my_id;
$$;

-- 2. get_conv_messages amélioré : jointure profiles pour éviter requêtes supplémentaires
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
  ORDER BY m.created_at ASC;
$$;

-- 3. RPC atomique pour envoi message admin (remplace 4+ requêtes client)
CREATE OR REPLACE FUNCTION public.send_admin_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
  SELECT p.full_name, p.avatar_url INTO sname, savatar
  FROM public.profiles p WHERE p.id = sender_id;

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content,
    COALESCE(sname, 'Admin'),
    savatar);

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = conv_id;

  UPDATE public.conversation_participants
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE conversation_id = conv_id AND profile_id != sender_id;
END;
$$;

-- 4. Index pour accélérer les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_participants_profile ON public.conversation_participants (profile_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON public.conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products (active);
