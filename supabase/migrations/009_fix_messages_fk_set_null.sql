-- ===========================
-- FIX MESSAGES FK CASCADE -> SET NULL
-- Bug 1 (Critique) : quand un client supprime son compte,
-- ses messages étaient supprimés en cascade.
-- Désormais sender_id passe à NULL, les messages restent.
-- ===========================

-- Étape 1 : rendre sender_id nullable pour autoriser SET NULL
ALTER TABLE public.messages
    ALTER COLUMN sender_id DROP NOT NULL;

-- Étape 2 : supprimer l'ancienne contrainte CASCADE
ALTER TABLE public.messages
    DROP CONSTRAINT messages_sender_id_fkey;

-- Étape 3 : recréer la contrainte avec SET NULL
ALTER TABLE public.messages
    ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- Vérification : doit retourner "SET NULL" dans delete_rule
-- SELECT constraint_name, delete_rule
-- FROM information_schema.referential_constraints
-- WHERE constraint_name = 'messages_sender_id_fkey';
