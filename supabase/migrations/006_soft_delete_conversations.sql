-- ===========================
-- SOFT DELETE CONVERSATIONS -- Trusttec
-- ===========================
-- La suppression est désormais "soft" : chaque participant peut masquer
-- une conversation de sa propre vue, sans affecter les autres participants.
-- Les messages sont conservés pour l'autre partie.
--
-- Comportement Alibaba : si l'autre partie envoie un nouveau message,
-- la conversation est restaurée automatiquement pour le destinataire.

-- 1. Ajout de la colonne deleted_at à conversation_participants
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Index partiel pour les requêtes de filtrage
CREATE INDEX IF NOT EXISTS idx_cp_active
  ON public.conversation_participants (profile_id, conversation_id)
  WHERE deleted_at IS NULL;

-- 3. Mise à jour des RLS policies

-- conversations SELECT : l'utilisateur ne voit que les conversations
-- où il est participant actif (non soft-deleted)
DROP POLICY IF EXISTS conversations_select_participant ON public.conversations;
CREATE POLICY conversations_select_participant ON public.conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id
        AND profile_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- conversation_participants SELECT : l'utilisateur ne voit que ses
-- propres entrées actives (soft-delete = invisible)
DROP POLICY IF EXISTS cp_select_own ON public.conversation_participants;
CREATE POLICY cp_select_own ON public.conversation_participants
  FOR SELECT
  USING (profile_id = auth.uid() AND deleted_at IS NULL);

-- messages SELECT : l'utilisateur ne voit les messages que s'il est
-- encore participant actif
DROP POLICY IF EXISTS messages_select_participant ON public.messages;
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id
        AND profile_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- messages INSERT : seul un participant actif peut envoyer
DROP POLICY IF EXISTS messages_insert_participant ON public.messages;
CREATE POLICY messages_insert_participant ON public.messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id
        AND profile_id = auth.uid()
        AND deleted_at IS NULL
    )
  );

-- 4. RPC : delete_user_conversation (soft delete)
-- Au lieu de tout supprimer, on masque seulement la conversation
-- pour cet utilisateur. L'admin voit encore tout.
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

  UPDATE public.conversation_participants
  SET deleted_at = now()
  WHERE conversation_id = conv_id AND profile_id = user_id;
END;
$$;

-- 5. RPC : delete_admin_conversation (soft delete)
-- L'admin masque seulement de SA vue ; le client voit encore tout.
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

-- 6. Mise à jour send_chat_msg : restaure le destinataire soft-deleted
-- (comportement Alibaba : si le client écrit, la conversation réapparaît
-- pour l'admin qui l'avait supprimée)
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
  SET unread_count = COALESCE(unread_count, 0) + 1, deleted_at = NULL
  WHERE conversation_id = conv_id AND profile_id != sender_id;

  -- Si le destinataire était soft-deleted, il est restauré (deleted_at = NULL ci-dessus)
END;
$$;

-- 7. Mise à jour send_admin_msg : restaure le destinataire soft-deleted
-- (comportement Alibaba : si l'admin répond, la conversation réapparaît
-- pour le client qui l'avait supprimée)
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
  SET unread_count = COALESCE(unread_count, 0) + 1, deleted_at = NULL
  WHERE conversation_id = conv_id AND profile_id != sender_id;

  -- Si le destinataire était soft-deleted, il est restauré (deleted_at = NULL ci-dessus)
END;
$$;

-- 8. Mise à jour get_conv_messages : vérifie que l'appelant est
-- toujours participant actif (non soft-deleted)
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
        AND cp.deleted_at IS NULL
    )
  ORDER BY m.created_at ASC;
$$;
