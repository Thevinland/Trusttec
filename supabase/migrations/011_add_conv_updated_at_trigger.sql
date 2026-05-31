-- ===========================
-- ADD updated_at TRIGGER ON conversations
-- Bug 3 (Mineur) : conversations.updated_at n'était jamais
-- mis à jour après la création de la conversation.
-- On ajoute un trigger AFTER INSERT sur messages qui met
-- à jour updated_at = now() sur la conversation parente.
-- ===========================

-- Étape 1 : créer la fonction trigger
CREATE OR REPLACE FUNCTION public.update_conversation_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    UPDATE public.conversations
    SET updated_at = now()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

-- Étape 2 : attacher le trigger sur INSERT dans messages
CREATE TRIGGER trg_update_conv_timestamp
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_timestamp();

-- Vérification : doit retourner le trigger créé
-- SELECT trigger_name, event_manipulation, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trg_update_conv_timestamp';
