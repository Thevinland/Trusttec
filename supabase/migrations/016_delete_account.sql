-- ===========================
-- DELETE ACCOUNT FUNCTION -- Trusttec
-- ===========================
-- Permet à un utilisateur de supprimer son propre compte.
-- SECURITY DEFINER bypasse RLS pour accéder à auth.users.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.conversation_participants WHERE profile_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;
