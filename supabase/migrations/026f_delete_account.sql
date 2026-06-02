CREATE OR REPLACE FUNCTION public.delete_my_account()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.churn_log DEFAULT VALUES;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;