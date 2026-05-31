-- ===========================
-- SUPER ADMIN ROLE -- Trusttec
-- ===========================
-- Ajoute le rôle super_admin qui a autorité sur les autres admins.
-- Un super_admin peut créer/rétrograder des admins, gérer produits,
-- catégories et chat (comme un admin normal).
-- Un admin normal ne peut PAS gérer les autres admins.

-- 1. Étendre le CHECK constraint de profiles pour inclure super_admin
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'admin', 'super_admin'));

-- 2. Fonction is_admin() — retourne true pour admin ET super_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

-- 3. Fonction is_super_admin() — uniquement pour super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- 4. Remplacer profiles_update_admin par une policy qui exige super_admin
--    (seul super_admin peut modifier les profils des autres)
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (public.is_super_admin());

-- 5. Mettre à jour send_admin_msg pour autoriser admin ET super_admin
CREATE OR REPLACE FUNCTION public.send_admin_msg(conv_id uuid, sender_id uuid, content text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sname text;
  savatar text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = sender_id AND role IN ('admin', 'super_admin')) THEN
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
END;
$$;

-- 6. Mettre à jour delete_admin_conversation pour autoriser admin ET super_admin
CREATE OR REPLACE FUNCTION public.delete_admin_conversation(conv_id uuid, admin_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = admin_id AND role IN ('admin', 'super_admin')) THEN
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

-- 7. Mettre à jour create_conv_with_admin pour inclure super_admin
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
    SELECT id FROM public.profiles WHERE role IN ('admin', 'super_admin')
  LOOP
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_conv_id, admin_profile.id);
  END LOOP;

  RETURN new_conv_id;
END;
$$;

-- 8. Promouvoir le premier admin (le plus ancien) en super_admin
--    (s'il n'y a pas encore de super_admin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'super_admin') THEN
    UPDATE public.profiles
    SET role = 'super_admin'
    WHERE id = (
      SELECT id FROM public.profiles
      WHERE role = 'admin'
      ORDER BY created_at ASC
      LIMIT 1
    );
  END IF;
END;
$$;
