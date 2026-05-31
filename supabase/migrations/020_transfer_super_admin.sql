-- ===========================
-- TRANSFER SUPER ADMIN -- Trusttec
-- ===========================
-- Permet à un super_admin de transférer son rôle à un autre admin.
-- Le super_admin actuel devient admin, et l'admin cible devient super_admin.
-- Utilise SECURITY DEFINER pour contourner RLS (l'utilisateur ne peut pas
-- modifier son propre rôle via la policy profiles_update_own).

CREATE OR REPLACE FUNCTION public.transfer_super_admin(target_admin_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller_role text;
  target_role text;
BEGIN
  -- Vérifier que l'appelant est super_admin
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();
  IF caller_role IS NULL OR caller_role != 'super_admin' THEN
    RAISE EXCEPTION 'Seul un super_admin peut transférer le rôle';
  END IF;

  -- Vérifier que la cible existe et est admin (pas super_admin)
  SELECT role INTO target_role FROM public.profiles WHERE id = target_admin_id;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Utilisateur cible introuvable';
  END IF;
  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'La cible est déjà super_admin';
  END IF;
  IF target_role != 'admin' THEN
    RAISE EXCEPTION 'La cible doit être un admin';
  END IF;

  -- Interdire l'auto-transfert
  IF target_admin_id = auth.uid() THEN
    RAISE EXCEPTION 'Vous ne pouvez pas vous transférer le rôle à vous-même';
  END IF;

  -- Transférer : le caller devient admin, la cible devient super_admin
  UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
  UPDATE public.profiles SET role = 'super_admin' WHERE id = target_admin_id;
END;
$$;
