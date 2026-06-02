-- ===========================
-- FIX EVENT STORM — Trusttec
-- ===========================
-- 1. mark_conversation_read: remove unread_count = 0, keep only last_read_at
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conv_id   uuid,
  p_profile_id uuid
)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  UPDATE public.conversation_participants
    SET last_read_at  = now()
    WHERE conversation_id = p_conv_id
      AND profile_id      = p_profile_id;
END;
$$;
