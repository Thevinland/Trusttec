-- ===========================
-- FIX RLS INFINITE RECURSION -- Trusttec
-- ===========================
-- Le problème : plusieurs policies interrogeaient la table `profiles`
-- depuis une policy SUR `profiles`, créant une récursion infinie.
--
-- Solution : fonction SECURITY DEFINER qui bypasse RLS pour
-- vérifier le rôle admin. Toutes les policies admin l'utilisent.

-- 1. Fonction utilitaire : is_admin() — bypasse RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- 2. Supprimer les policies récursives sur profiles
DROP POLICY IF EXISTS profiles_read_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;

-- 3. Remplacer par des policies utilisant is_admin()
CREATE POLICY profiles_read_admin ON public.profiles
  FOR SELECT
  USING (public.is_admin());

CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (public.is_admin());

-- 4. Corriger les policies existantes sur categories et products
--    (créées depuis le dashboard Supabase, elles aussi récursives)

-- On ne peut pas DROP/CREATE par nom avec des caractères spéciaux facilement,
-- donc on utilise DO $$ pour supprimer et recréer

DO $$
BEGIN
  -- Supprimer les anciennes policies problématiques (noms français du dashboard)
  DROP POLICY IF EXISTS "Admin write categories" ON public.categories;
  DROP POLICY IF EXISTS "Admin write products" ON public.products;
  DROP POLICY IF EXISTS "Lecture publique catégories" ON public.categories;
  DROP POLICY IF EXISTS "Lecture publique produits" ON public.products;
  DROP POLICY IF EXISTS "Insert propre profile" ON public.profiles;
  DROP POLICY IF EXISTS "Read own and chat participants profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Update propre profile" ON public.profiles;
END;
$$;

-- Recréer les policies categories
CREATE POLICY categories_select_all ON public.categories
  FOR SELECT
  USING (true);

CREATE POLICY categories_admin_all ON public.categories
  FOR ALL
  USING (public.is_admin());

-- Recréer les policies products
CREATE POLICY products_select_all ON public.products
  FOR SELECT
  USING (true);

CREATE POLICY products_admin_all ON public.products
  FOR ALL
  USING (public.is_admin());

-- 5. Nettoyer les vieilles policies chat du dashboard (remplacées par nos migrations)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Lecture conversations" ON public.conversations;
  DROP POLICY IF EXISTS "Insert conversations" ON public.conversations;
  DROP POLICY IF EXISTS "Update conversations participants" ON public.conversations;
  DROP POLICY IF EXISTS "Lecture participants" ON public.conversation_participants;
  DROP POLICY IF EXISTS "Insert participants" ON public.conversation_participants;
  DROP POLICY IF EXISTS "Update own participant" ON public.conversation_participants;
  DROP POLICY IF EXISTS "Lecture messages" ON public.messages;
  DROP POLICY IF EXISTS "Insert messages" ON public.messages;
  DROP POLICY IF EXISTS "Insert propre profile" ON public.profiles;
  DROP POLICY IF EXISTS "Read own and chat participants profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Update propre profile" ON public.profiles;
END;
$$;

-- 6. Recréer la policy profiles pour permettre aux participants
--    d'une conversation de voir le profil des autres participants
CREATE POLICY profiles_read_chat_participants ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.profile_id = profiles.id
        AND EXISTS (
          SELECT 1 FROM public.conversation_participants cp2
          WHERE cp2.conversation_id = cp.conversation_id
            AND cp2.profile_id = auth.uid()
            AND cp2.deleted_at IS NULL
        )
    )
  );
