-- ===========================
-- CHAT SECURITY & RPC FIXES -- Trusttec
-- ===========================

-- 0. ENABLE REALTIME REPLICATION for chat tables (requis pour les mises à jour en direct)
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.conversation_participants;

-- 1. ENABLE ROW LEVEL SECURITY on all chat tables
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 2. RLS POLICIES for conversations
DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id AND profile_id = auth.uid()
    )
  );

-- 3. RLS POLICIES for conversation_participants
DROP POLICY IF EXISTS cp_select_own ON public.conversation_participants;
CREATE POLICY cp_select_own ON public.conversation_participants
  FOR SELECT
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS cp_delete_own ON public.conversation_participants;
CREATE POLICY cp_delete_own ON public.conversation_participants
  FOR DELETE
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS cp_insert_self ON public.conversation_participants;
CREATE POLICY cp_insert_self ON public.conversation_participants
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS cp_update_own_unread ON public.conversation_participants;
CREATE POLICY cp_update_own_unread ON public.conversation_participants
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- 4. RLS POLICIES for messages
DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS messages_insert_participant ON public.messages;
CREATE POLICY messages_insert_participant ON public.messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND profile_id = auth.uid()
    )
  );

-- 5. RPC: send_chat_msg (customer-side, missing previously)
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

  INSERT INTO public.messages (conversation_id, sender_id, content, sender_name, sender_avatar)
  VALUES (conv_id, sender_id, content, sname, savatar);

  UPDATE public.conversations
  SET last_message = content, last_message_at = now()
  WHERE id = conv_id;

  UPDATE public.conversation_participants
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE conversation_id = conv_id AND profile_id != sender_id;
END;
$$;

-- 6. RPC: send_admin_msg (fixed with authorization checks)
CREATE OR REPLACE FUNCTION public.send_admin_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = sender_id AND role = 'admin') THEN
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

-- 7. RPC: delete_admin_conversation (fixed with authorization check)
CREATE OR REPLACE FUNCTION public.delete_admin_conversation(conv_id uuid, admin_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  DELETE FROM public.messages WHERE conversation_id = conv_id;
  DELETE FROM public.conversation_participants WHERE conversation_id = conv_id;
  DELETE FROM public.conversations WHERE id = conv_id;
END;
$$;

-- 8. DB-level protection: prevent deleting category with products
CREATE OR REPLACE FUNCTION public.check_category_empty()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE category = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete category with existing products';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_category_empty ON public.categories;
CREATE TRIGGER trg_check_category_empty
  BEFORE DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.check_category_empty();

-- 9. RPC: create_conv_with_admin (atomic, missing previously)
CREATE OR REPLACE FUNCTION public.create_conv_with_admin(subject text, user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  new_conv_id uuid;
  admin_profile RECORD;
BEGIN
  INSERT INTO public.conversations (subject)
  VALUES (subject)
  RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
  VALUES (new_conv_id, user_id);

  FOR admin_profile IN
    SELECT id FROM public.profiles WHERE role = 'admin'
  LOOP
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_conv_id, admin_profile.id);
  END LOOP;

  RETURN new_conv_id;
END;
$$;
