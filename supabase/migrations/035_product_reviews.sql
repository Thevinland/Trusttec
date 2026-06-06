-- ===========================
-- PRODUCT REVIEWS + RATINGS
-- Systeme d'avis par produit
-- avec note etoilee 1-5 (style Alibaba)
-- ===========================

-- 1. Table principale
CREATE TABLE IF NOT EXISTS public.product_reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id text NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title text,
    comment text,
    helpful_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Un seul avis par utilisateur et par produit
    UNIQUE(product_id, user_id)
);

-- 2. Index pour les requetes frequentes
CREATE INDEX IF NOT EXISTS idx_reviews_product_created
    ON public.product_reviews (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_user
    ON public.product_reviews (user_id);

-- 3. RLS
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut lire les avis (meme non connecte)
DROP POLICY IF EXISTS reviews_select_all ON public.product_reviews;
CREATE POLICY reviews_select_all ON public.product_reviews
  FOR SELECT
  USING (true);

-- Un utilisateur authentifie peut creer un avis pour lui-meme
DROP POLICY IF EXISTS reviews_insert_own ON public.product_reviews;
CREATE POLICY reviews_insert_own ON public.product_reviews
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Un utilisateur peut modifier son propre avis
DROP POLICY IF EXISTS reviews_update_own ON public.product_reviews;
CREATE POLICY reviews_update_own ON public.product_reviews
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Suppression : auteur OU admin/super_admin
DROP POLICY IF EXISTS reviews_delete_owner_or_admin ON public.product_reviews;
CREATE POLICY reviews_delete_owner_or_admin ON public.product_reviews
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

-- 4. Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_review_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_updated_at ON public.product_reviews;
CREATE TRIGGER trg_review_updated_at
  BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_review_timestamp();

-- 5. Vue agregee : moyenne + repartition par produit
--    => permet d'afficher "4.6 / 5 (128 avis)" sur la card
CREATE OR REPLACE VIEW public.product_review_stats AS
SELECT
  product_id,
  COUNT(*)::int                          AS review_count,
  ROUND(AVG(rating)::numeric, 2)         AS avg_rating,
  COUNT(*) FILTER (WHERE rating = 5)::int AS count_5,
  COUNT(*) FILTER (WHERE rating = 4)::int AS count_4,
  COUNT(*) FILTER (WHERE rating = 3)::int AS count_3,
  COUNT(*) FILTER (WHERE rating = 2)::int AS count_2,
  COUNT(*) FILTER (WHERE rating = 1)::int AS count_1
FROM public.product_reviews
GROUP BY product_id;

GRANT SELECT ON public.product_review_stats TO anon, authenticated;
