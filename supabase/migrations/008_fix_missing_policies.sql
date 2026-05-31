-- ===========================
-- FIX MISSING RLS POLICIES -- Trusttec
-- ===========================
-- Les policies dashboard ont été nettoyées dans 007,
-- mais certaines policies INSERT/UPDATE/DDELETE manquent.
-- Les RPC SECURITY DEFINER les by-passent, mais le REST API en a besoin.

-- 1. conversation_participants — INSERT, UPDATE, DELETE
CREATE POLICY cp_insert_self ON public.conversation_participants
  FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY cp_update_own ON public.conversation_participants
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY cp_delete_own ON public.conversation_participants
  FOR DELETE
  USING (profile_id = auth.uid());

-- 2. conversations — INSERT (create_conv_with_admin RPC bypasses RLS,
--    mais on garde une policy REST pour la sécurité)
CREATE POLICY conversations_insert_participant ON public.conversations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id AND profile_id = auth.uid()
    )
  );

CREATE POLICY conversations_update_participant ON public.conversations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id AND profile_id = auth.uid() AND deleted_at IS NULL
    )
  );

-- 3. messages — INSERT via REST (même si les RPC sont privilégiés)
--    La policy messages_insert_participant existe déjà avec WITH CHECK,
--    on la recrée pour être sûr
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
