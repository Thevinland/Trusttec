-- ===========================
-- CORRECTIFS SYSTEME D'AVIS
-- ===========================
-- 1) toggle_review_helpful : v_existed etait declare boolean mais recoit
--    un entier via GET DIAGNOSTICS, entrainant une erreur 42883
--    (operator does not exist: boolean = integer) a chaque vote.
-- 2) Vue publique des noms d'auteurs : les policies RLS de profiles
--    etaient trop restrictives, donc l'embed PostgREST
--    profiles!product_reviews_user_id_fkey(full_name) renvoyait null
--    pour tout le monde (sauf l'auteur lui-meme), affichant
--    systematiquement "Utilisateur" dans la liste des avis.
-- ===========================

-- =============================================================
-- 1. Fix toggle_review_helpful
-- =============================================================
CREATE OR REPLACE FUNCTION public.toggle_review_helpful(p_review_id uuid)
RETURNS TABLE (helpful_count int, voted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count int;
  v_existed int;   -- FIX: etait boolean, doit etre integer
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Toggle le vote de l'utilisateur (1 seule ecriture)
  DELETE FROM public.review_votes
    WHERE review_id = p_review_id AND user_id = v_user;
  GET DIAGNOSTICS v_existed = ROW_COUNT;

  IF v_existed = 0 THEN
    INSERT INTO public.review_votes (review_id, user_id) VALUES (p_review_id, v_user);
  END IF;

  -- Mise a jour du compteur (1 seule ecriture)
  UPDATE public.product_reviews
    SET helpful_count = (
      SELECT COUNT(*)::int FROM public.review_votes WHERE review_id = p_review_id
    )
    WHERE id = p_review_id
    RETURNING product_reviews.helpful_count INTO v_count;

  RETURN QUERY SELECT v_count, (v_existed = 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_review_helpful(uuid) TO authenticated;

-- =============================================================
-- 2. Vue publique reviewer_names
--    - Expose UNIQUEMENT id + full_name (pas d'email, phone, role)
--    - Lecture publique (anon + authenticated) via PostgREST embed
--    - Reutilise la FK product_reviews_user_id_fkey cote client
-- =============================================================
CREATE OR REPLACE VIEW public.reviewer_names AS
SELECT
  id,
  full_name
FROM public.profiles
WHERE full_name IS NOT NULL AND length(trim(full_name)) > 0;

GRANT SELECT ON public.reviewer_names TO anon, authenticated;

COMMENT ON VIEW public.reviewer_names IS
  'Vue publique des noms affichables sur les avis (id + full_name uniquement).';
