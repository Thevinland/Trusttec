-- ===========================
-- REMOVE NULL-UNSAFE increment_unread
-- Bug 2 (Moyen) : la fonction increment_unread utilise
-- unread_count + 1 sans COALESCE, ce qui donne NULL si
-- unread_count est NULL. La version sûre increment_unread_safe
-- existe déjà et est utilisée par le code JS.
-- ===========================

-- Supprimer la version dangereuse
DROP FUNCTION IF EXISTS public.increment_unread(uuid, uuid);

-- Vérification : doit retourner 1 seule ligne (increment_unread_safe uniquement)
-- SELECT routine_name
-- FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name LIKE 'increment_unread%';
