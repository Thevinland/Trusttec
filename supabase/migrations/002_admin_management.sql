-- ===========================
-- ADMIN MANAGEMENT -- Trusttec
-- ===========================

-- Ensure profiles table has proper RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own profile
DROP POLICY IF EXISTS profiles_read_own ON public.profiles;
CREATE POLICY profiles_read_own ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: admins can read all profiles
DROP POLICY IF EXISTS profiles_read_admin ON public.profiles;
CREATE POLICY profiles_read_admin ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: admins can update any profile (to change roles)
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Policy: users can update their own profile (name, avatar only)
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND (
      -- Allow updating full_name and avatar_url
      (COALESCE(role, 'customer') = (SELECT COALESCE(role, 'customer') FROM public.profiles WHERE id = auth.uid()))
    )
  );
