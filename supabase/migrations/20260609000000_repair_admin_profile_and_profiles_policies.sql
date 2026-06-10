/*
  # Repair profiles RLS and bootstrap admin profile

  The remote database can get stuck with recursive policies on `profiles`,
  which prevents even the signed-in user from reading their own profile.
  This migration re-applies the non-recursive policies and makes sure the
  seed admin user has an admin profile.
*/

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('customer', 'restaurant_owner', 'admin'));

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT role = 'admin'
    FROM public.profiles
    WHERE id = user_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.repair_bootstrap_admin_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  admin_user auth.users%ROWTYPE;
BEGIN
  SELECT *
  INTO admin_user
  FROM auth.users
  WHERE lower(email) = 'admin@admin.com'
  ORDER BY created_at
  LIMIT 1;

  IF admin_user.id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (admin_user.id, admin_user.email, 'Administrador', 'admin')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
        role = 'admin',
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_bootstrap_admin_profile() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can create user profiles" ON profiles;
DROP POLICY IF EXISTS "Restaurant owners can view customer profiles for their orders" ON profiles;

CREATE OR REPLACE FUNCTION public.restaurant_owner_can_view_customer(
  owner_user_id uuid,
  customer_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.restaurants
      ON restaurants.id = orders.restaurant_id
    WHERE orders.customer_id = customer_user_id
      AND restaurants.owner_id = owner_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.restaurant_owner_can_view_customer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restaurant_owner_can_view_customer(uuid, uuid) TO authenticated;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admin can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admin can create user profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Restaurant owners can view customer profiles for their orders"
  ON profiles FOR SELECT
  TO authenticated
  USING (public.restaurant_owner_can_view_customer(auth.uid(), id));

SELECT public.repair_bootstrap_admin_profile();
