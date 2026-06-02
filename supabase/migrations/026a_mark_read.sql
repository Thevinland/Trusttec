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