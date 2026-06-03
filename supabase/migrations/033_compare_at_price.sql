-- Migration 033: Add compare_at_price for strikethrough pricing
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS compare_at_price integer;
