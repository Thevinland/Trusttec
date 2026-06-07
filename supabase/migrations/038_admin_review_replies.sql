-- ===========================
-- REPONSES ADMIN AUX AVIS
-- - Colonnes admin_reply / admin_reply_at / admin_reply_by
-- - RPC set_admin_reply / delete_admin_reply (admin + super_admin)
-- - Vue publique pour exposer le nom de l'admin qui a repondu
-- - Vue admin enrichie (review_admin_overview) avec les nouveaux champs
-- ===========================

-- =============================================================
-- 1. Colonnes sur product_reviews
-- =============================================================
ALTER TABLE public.product_reviews
  ADD COLUMN IF NOT EXISTS admin_reply    text,
  ADD COLUMN IF NOT EXISTS admin_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reply_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Un reply non vide doit avoir une date et un auteur
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_admin_reply_consistency'
  ) THEN
    ALTER TABLE public.product_reviews
      ADD CONSTRAINT reviews_admin_reply_consistency
      CHECK (
        (admin_reply IS NULL AND admin_reply_at IS NULL AND admin_reply_by IS NULL)
        OR
        (admin_reply IS NOT NULL AND admin_reply_at IS NOT NULL AND admin_reply_by IS NOT NULL)
      );
  END IF;
END $$;

-- =============================================================
-- 2. Vue publique des noms d'admin (pour afficher "Reponse de X")
--    Limite l'exposition a id + full_name (pas d'email/phone/role)
-- =============================================================
CREATE OR REPLACE VIEW public.admin_replier_names AS
SELECT
  id,
  full_name
FROM public.profiles
WHERE role IN ('admin', 'super_admin')
  AND full_name IS NOT NULL
  AND length(trim(full_name)) > 0;

GRANT SELECT ON public.admin_replier_names TO anon, authenticated;

COMMENT ON VIEW public.admin_replier_names IS
  'Vue publique des noms d''admins (id + full_name uniquement) pour affichage des reponses officielles.';

-- =============================================================
-- 3. RPC : set_admin_reply
--    - Verifie que l'appelant est admin ou super_admin
--    - Si p_reply est NULL ou vide -> supprime la reponse
--    - Sinon -> cree / remplace la reponse et met a jour les meta
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_admin_reply(
  p_review_id uuid,
  p_reply     text
)
RETURNS public.product_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_clean text;
  v_result public.product_reviews;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent repondre aux avis.';
  END IF;

  v_clean := NULLIF(trim(p_reply), '');

  -- Si la reponse est vide / NULL -> on supprime
  IF v_clean IS NULL THEN
    UPDATE public.product_reviews
      SET admin_reply = NULL,
          admin_reply_at = NULL,
          admin_reply_by = NULL
      WHERE id = p_review_id
      RETURNING * INTO v_result;

    IF v_result.id IS NULL THEN
      RAISE EXCEPTION 'Avis introuvable.';
    END IF;

    RETURN v_result;
  END IF;

  IF length(v_clean) > 2000 THEN
    RAISE EXCEPTION 'La reponse ne peut pas depasser 2000 caracteres.';
  END IF;

  UPDATE public.product_reviews
    SET admin_reply    = v_clean,
        admin_reply_at = now(),
        admin_reply_by = v_user
    WHERE id = p_review_id
    RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Avis introuvable.';
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_admin_reply(uuid, text) TO authenticated;

-- =============================================================
-- 4. Vue admin enrichie : review_admin_overview
--    - Ajout des colonnes admin_reply / admin_reply_at / admin_reply_by
--    - Join avec admin_replier_names pour recuperer le nom de l'admin
-- =============================================================
DROP VIEW IF EXISTS public.review_admin_overview;

CREATE VIEW public.review_admin_overview AS
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
  r.admin_reply,
  r.admin_reply_at,
  r.admin_reply_by,
  p.name  AS product_name,
  pr.full_name AS user_name,
  pr.email     AS user_email,
  ar.full_name AS admin_reply_by_name,
  (SELECT COUNT(*) FROM public.review_reports rr WHERE rr.review_id = r.id)::int AS report_count,
  (SELECT array_agg(reason) FROM public.review_reports rr WHERE rr.review_id = r.id) AS report_reasons
FROM public.product_reviews r
LEFT JOIN public.products p   ON p.id  = r.product_id
LEFT JOIN public.profiles pr  ON pr.id = r.user_id
LEFT JOIN public.admin_replier_names ar ON ar.id = r.admin_reply_by;

GRANT SELECT ON public.review_admin_overview TO authenticated;

-- =============================================================
-- 5. RLS : on bloque la modification directe des colonnes admin_reply
--    depuis le client. Seul le RPC set_admin_reply (SECURITY DEFINER)
--    peut les modifier. Les clients peuvent toujours les lire.
-- =============================================================
-- La policy reviews_update_own ne SELECTionne que auth.uid() = user_id,
-- donc un client ne peut pas modifier les avis des autres. Mais on veut
-- aussi empecher un client de modifier admin_reply sur SON PROPRE avis.
-- Pour cela on cree une policy UPDATE plus stricte qui n'autorise que
-- les colonnes non-admin.
-- (PostgreSQL ne permettant pas les policies par colonne, on remplace
-- par un trigger BEFORE UPDATE qui reinitialise les colonnes admin.)

CREATE OR REPLACE FUNCTION public.guard_review_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_role text;
BEGIN
  -- Si l'appelant n'est pas admin, on reinitialise les colonnes admin
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN
    NEW.admin_reply    := OLD.admin_reply;
    NEW.admin_reply_at := OLD.admin_reply_at;
    NEW.admin_reply_by := OLD.admin_reply_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_review_admin_columns ON public.product_reviews;
CREATE TRIGGER trg_guard_review_admin_columns
  BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_review_admin_columns();
