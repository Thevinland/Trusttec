-- ===========================
-- FIX SCHEMA & SECURITY -- Trusttec
-- ===========================

-- 1. FK products.category -> categories(id) ON DELETE SET NULL
ALTER TABLE public.products ALTER COLUMN category DROP NOT NULL;
ALTER TABLE public.products ADD CONSTRAINT fk_products_category
  FOREIGN KEY (category) REFERENCES public.categories(id) ON DELETE SET NULL;

-- 2. DB-level trigger: prevent deleting a category with existing products
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

-- 3. RPC: send_chat_msg with participant check
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

-- 4. RPC: send_admin_msg with admin + participant checks
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

-- 5. RPC: delete_admin_conversation with admin authorization check
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
