-- ===========================
-- ADD PHONE TO PROFILES -- Trusttec
-- ===========================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
