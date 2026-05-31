-- ===========================
-- FIX ADMIN STATS ACCESS -- Trusttec
-- ===========================
-- Les admins ajoutés après la création des conversations ne peuvent pas
-- voir les statistiques (messages, conversations) à cause des RLS policies
-- qui filtrent par participant. On ajoute des policies admin bypass.

-- 1. Policy admin pour voir TOUTES les conversations
DROP POLICY IF EXISTS conversations_select_admin ON public.conversations;
CREATE POLICY conversations_select_admin ON public.conversations
  FOR SELECT
  USING (public.is_admin());

-- 2. Policy admin pour voir TOUS les messages
DROP POLICY IF EXISTS messages_select_admin ON public.messages;
CREATE POLICY messages_select_admin ON public.messages
  FOR SELECT
  USING (public.is_admin());

-- 3. Policy admin pour voir TOUS les participants (stats)
DROP POLICY IF EXISTS cp_select_admin ON public.conversation_participants;
CREATE POLICY cp_select_admin ON public.conversation_participants
  FOR SELECT
  USING (public.is_admin());
