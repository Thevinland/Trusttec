-- ===========================
-- ACTIVITY LOGS -- Trusttec
-- ===========================
-- Enregistre automatiquement les actions des admins
-- (produits, catégories, admins, connexions)

-- 1. Table des logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    admin_name text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    entity_name text,
    details jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_type ON public.activity_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_admin_id ON public.activity_logs (admin_id);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 2. RLS : seul super_admin peut lire les logs
DROP POLICY IF EXISTS activity_logs_select_super_admin ON public.activity_logs;
CREATE POLICY activity_logs_select_super_admin ON public.activity_logs
  FOR SELECT
  USING (public.is_super_admin());

-- 3. Trigger : produit modifié
CREATE OR REPLACE FUNCTION public.log_product_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_name text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = v_admin_id;
  IF v_admin_name IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  INSERT INTO public.activity_logs (admin_id, admin_name, action, entity_type, entity_id, entity_name)
  VALUES (
    v_admin_id, v_admin_name,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' WHEN 'DELETE' THEN 'deleted' END,
    'product',
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE TG_OP WHEN 'DELETE' THEN OLD.name ELSE NEW.name END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_product_changes ON public.products;
CREATE TRIGGER trg_log_product_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_product_changes();

-- 4. Trigger : catégorie modifiée
CREATE OR REPLACE FUNCTION public.log_category_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_name text;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = v_admin_id;
  IF v_admin_name IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  INSERT INTO public.activity_logs (admin_id, admin_name, action, entity_type, entity_id, entity_name)
  VALUES (
    v_admin_id, v_admin_name,
    CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' WHEN 'DELETE' THEN 'deleted' END,
    'category',
    CASE TG_OP WHEN 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE TG_OP WHEN 'DELETE' THEN OLD.label ELSE NEW.label END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_category_changes ON public.categories;
CREATE TRIGGER trg_log_category_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.log_category_changes();

-- 5. Trigger : changement de rôle admin
CREATE OR REPLACE FUNCTION public.log_admin_role_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_name text;
BEGIN
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN RETURN NEW; END IF;

  v_admin_id := auth.uid();
  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = v_admin_id;

  INSERT INTO public.activity_logs (admin_id, admin_name, action, entity_type, entity_id, entity_name, details)
  VALUES (
    v_admin_id, v_admin_name,
    CASE WHEN NEW.role IN ('admin', 'super_admin') THEN 'promoted' ELSE 'demoted' END,
    'admin',
    NEW.id,
    COALESCE(NEW.full_name, NEW.email),
    jsonb_build_object('from_role', OLD.role, 'to_role', NEW.role)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_admin_role_change ON public.profiles;
CREATE TRIGGER trg_log_admin_role_change
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.log_admin_role_change();

-- 6. RPC : loguer une connexion admin
CREATE OR REPLACE FUNCTION public.log_admin_login(admin_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT full_name INTO v_admin_name FROM public.profiles WHERE id = admin_id;
  IF v_admin_name IS NULL THEN RETURN; END IF;

  INSERT INTO public.activity_logs (admin_id, admin_name, action, entity_type, entity_id)
  VALUES (admin_id, v_admin_name, 'logged_in', 'session', admin_id::text);
END;
$$;

-- 7. RPC : loguer la création d'un admin (appelé depuis l'Edge Function)
CREATE OR REPLACE FUNCTION public.log_admin_created(creator_id uuid, new_admin_id uuid, new_admin_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_creator_name text;
BEGIN
  SELECT full_name INTO v_creator_name FROM public.profiles WHERE id = creator_id;

  INSERT INTO public.activity_logs (admin_id, admin_name, action, entity_type, entity_id, entity_name, details)
  VALUES (
    creator_id,
    v_creator_name,
    'created',
    'admin',
    new_admin_id::text,
    new_admin_name,
    jsonb_build_object('new_role', 'admin')
  );
END;
$$;
