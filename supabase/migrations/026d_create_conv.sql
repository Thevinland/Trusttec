CREATE OR REPLACE FUNCTION public.create_conv_with_admin(subject text, user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  new_conv_id uuid;
  admin_id uuid;
BEGIN
  INSERT INTO public.conversations (subject)
    VALUES (subject)
    RETURNING id INTO new_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, profile_id)
    VALUES (new_conv_id, user_id);

  admin_id := public.get_admin_for_chat();
  IF admin_id IS NOT NULL AND admin_id <> user_id THEN
    INSERT INTO public.conversation_participants (conversation_id, profile_id)
      VALUES (new_conv_id, admin_id);
  END IF;

  RETURN new_conv_id;
END;
$$;