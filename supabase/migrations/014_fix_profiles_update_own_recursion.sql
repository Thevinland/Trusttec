-- ===========================
-- FIX profiles_update_own RECURSION -- Trusttec
-- ===========================
-- La policy profiles_update_own avait une sous-requête sur public.profiles
-- dans sa clause WITH CHECK, causant une récursion infinie quand un
-- utilisateur tentait de modifier son avatar (ou nom).
--
-- Solution : fonction SECURITY DEFINER get_my_role() qui bypasse RLS.

-- 1. Fonction utilitaire : get_my_role() — bypasse RLS
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(role, 'customer') FROM public.profiles WHERE id = auth.uid();
$$;

-- 2. Remplacer profiles_update_own pour utiliser get_my_role()
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND (COALESCE(role, 'customer') = public.get_my_role())
  );
