-- ===========================
-- INITIAL SCHEMA -- Trusttec
-- ===========================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROFILES (liée à auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    full_name text,
    role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. CATEGORIES
CREATE TABLE IF NOT EXISTS public.categories (
    id text PRIMARY KEY,
    label text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0
);

-- 3. PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    price integer NOT NULL CHECK (price >= 0),
    image_url text,
    category text REFERENCES public.categories(id) ON DELETE SET NULL,
    active boolean NOT NULL DEFAULT true,
    colors jsonb NOT NULL DEFAULT '[]'::jsonb,
    specs jsonb NOT NULL DEFAULT '[]'::jsonb,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject text,
    last_message text,
    last_message_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. CONVERSATION_PARTICIPANTS
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    unread_count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, profile_id)
);

-- 6. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content text NOT NULL,
    media_url text,
    sender_name text,
    sender_avatar text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. INDEXES
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_participants_profile ON public.conversation_participants (profile_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON public.conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products (active);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations (last_message_at DESC);

-- 8. TRIGGER: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
