-- ===========================
-- AMELIORATIONS AVIS (v2)
-- - Votes "utile" idempotents (1 vote / user / avis)
-- - Signalements d'abus
-- - Edit window (30 jours) enforce cote serveur
-- - Anti-spam : 1 avis max / 5 min, 10 avis / 24h
-- - Tout via SECURITY DEFINER pour minimiser les checks RLS
--   (= moins de WAL genere, moins de CPU)
-- ===========================

-- =============================================================
-- 1. Table review_votes
-- =============================================================
CREATE TABLE IF NOT EXISTS public.review_votes (
    review_id uuid NOT NULL REFERENCES public.product_reviews(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (review_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_review_votes_user ON public.review_votes(user_id);

ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;
-- Un user voit uniquement ses propres votes
CREATE POLICY review_votes_select_own ON public.review_votes
  FOR SELECT USING (auth.uid() = user_id);
-- Pas de policy INSERT/UPDATE/DELETE = passe par RPC SECURITY DEFINER
-- (evite une avalanche de policies et de checks RLS)

-- =============================================================
-- 2. Table review_reports
-- =============================================================
CREATE TABLE IF NOT EXISTS public.review_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    review_id uuid NOT NULL REFERENCES public.product_reviews(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
    reason    text NOT NULL CHECK (reason IN ('spam','abuse','fake','other')),
    details   text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(review_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON public.review_reports(review_id);

ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
-- Un user voit uniquement ses propres signalements
CREATE POLICY review_reports_select_own ON public.review_reports
  FOR SELECT USING (auth.uid() = user_id);
-- Admins voient tout via la fonction get_pending_reports (SECURITY DEFINER)

-- =============================================================
-- 3. RPC : toggle_review_helpful
--    - 1 UPDATE sur product_reviews + 1 INSERT/DELETE sur review_votes
--    - Renvoie le nouveau compteur + l'etat "voted"
--    - Fait tout en 1 transaction, sans deborder sur d'autres tables
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
  v_existed boolean;
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
-- 4. RPC : report_review
--    - INSERT idempotent (UNIQUE sur review_id, user_id)
--    - Renvoie false si deja signale, true sinon
-- =============================================================
CREATE OR REPLACE FUNCTION public.report_review(p_review_id uuid, p_reason text, p_details text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.review_reports (review_id, user_id, reason, details)
    VALUES (p_review_id, v_user, p_reason, p_details)
    ON CONFLICT (review_id, user_id) DO NOTHING;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_review(uuid, text, text) TO authenticated;

-- =============================================================
-- 5. RPC : submit_review (atomique : insert + check anti-spam)
--    - Verifie l'edit window en cas d'UPDATE
--    - Verifie le rate-limit (1 avis / 5 min, 10 avis / 24h)
--    - Renvoie l'avis cree
-- =============================================================
CREATE OR REPLACE FUNCTION public.submit_review(
  p_product_id text,
  p_rating     smallint,
  p_title      text,
  p_comment    text
)
RETURNS public.product_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_existing public.product_reviews;
  v_new public.product_reviews;
  v_recent_count int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- Anti-spam : 1 avis max par 5 min pour ce user
  SELECT COUNT(*) INTO v_recent_count
    FROM public.product_reviews
    WHERE user_id = v_user
      AND created_at > now() - interval '5 minutes';
  IF v_recent_count > 0 THEN
    RAISE EXCEPTION 'Vous venez de poster un avis. Patientez 5 minutes.';
  END IF;

  -- Anti-spam : max 10 avis / 24h
  SELECT COUNT(*) INTO v_recent_count
    FROM public.product_reviews
    WHERE user_id = v_user
      AND created_at > now() - interval '24 hours';
  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'Limite quotidienne atteinte (10 avis / 24h).';
  END IF;

  -- Verifier si l'utilisateur a deja un avis pour ce produit
  SELECT * INTO v_existing
    FROM public.product_reviews
    WHERE product_id = p_product_id AND user_id = v_user
    FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    -- Update : uniquement dans la fenetre de 30 jours
    IF v_existing.created_at < now() - interval '30 days' THEN
      RAISE EXCEPTION 'La fenetre d''edition (30 jours) est depassee.';
    END IF;
    UPDATE public.product_reviews
      SET rating = p_rating, title = p_title, comment = p_comment
      WHERE id = v_existing.id
      RETURNING * INTO v_new;
  ELSE
    -- Insert
    INSERT INTO public.product_reviews (product_id, user_id, rating, title, comment)
      VALUES (p_product_id, v_user, p_rating, p_title, p_comment)
      RETURNING * INTO v_new;
  END IF;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_review(text, smallint, text, text) TO authenticated;

-- =============================================================
-- 6. RPC : delete_my_review
--    - Un user peut supprimer son propre avis
-- =============================================================
CREATE OR REPLACE FUNCTION public.delete_my_review(p_review_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM public.product_reviews
    WHERE id = p_review_id AND user_id = v_user;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_review(uuid) TO authenticated;

-- =============================================================
-- 7. Vue : join reviews + helpful + reported (pour l'admin)
-- =============================================================
CREATE OR REPLACE VIEW public.review_admin_overview AS
SELECT
  r.id,
  r.product_id,
  r.user_id,
  r.rating,
  r.title,
  r.comment,
  r.helpful_count,
  r.created_at,
  r.updated_at,
  p.name  AS product_name,
  pr.full_name AS user_name,
  pr.email     AS user_email,
  (SELECT COUNT(*) FROM public.review_reports rr WHERE rr.review_id = r.id)::int AS report_count,
  (SELECT array_agg(reason) FROM public.review_reports rr WHERE rr.review_id = r.id) AS report_reasons
FROM public.product_reviews r
LEFT JOIN public.products p  ON p.id  = r.product_id
LEFT JOIN public.profiles pr ON pr.id = r.user_id;

GRANT SELECT ON public.review_admin_overview TO authenticated;
