-- ===========================
-- MUST CHANGE PASSWORD -- Trusttec
-- ===========================
-- Ajoute un flag qui force un nouvel admin à changer son mot de passe
-- lors de sa première connexion.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Les admins peuvent lire must_change_password sur leur propre profil
-- (déjà permis par profiles_read_own)
-- Les admins peuvent mettre à jour must_change_password sur leur propre profil
-- (déjà permis par profiles_update_own car le rôle ne change pas)
