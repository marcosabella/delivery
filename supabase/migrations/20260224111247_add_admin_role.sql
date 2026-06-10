/*
  # Add Admin Role and Management Features

  ## Changes

  ### 1. Profile Role Updates
  - Add 'admin' as a valid role option
  - Admin users can create and manage restaurants and users

  ### 2. New Tables/Modifications
  - No new tables needed - existing schema supports admin role
  - Profile role constraint updated to include 'admin'

  ## Security
  - Admin can view and manage all restaurants
  - Admin can view all user profiles
  - Admin can create new restaurant owner accounts with credentials
  - Policies updated to allow admin access
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE profiles ADD COLUMN role text NOT NULL DEFAULT 'customer';
  ELSE
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
  END IF;
END $$;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('customer', 'restaurant_owner', 'admin'));

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Anyone can view active restaurants" ON restaurants;
DROP POLICY IF EXISTS "Restaurant owners can insert own restaurants" ON restaurants;
DROP POLICY IF EXISTS "Restaurant owners can update own restaurants" ON restaurants;
DROP POLICY IF EXISTS "Restaurant owners can delete own restaurants" ON restaurants;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admin can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Admin can create user profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Anyone can view active restaurants"
  ON restaurants FOR SELECT
  TO authenticated
  USING (is_active = true OR owner_id = auth.uid() OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Restaurant owners can insert own restaurants"
  ON restaurants FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'restaurant_owner'
    )
  );

CREATE POLICY "Admin can insert restaurants"
  ON restaurants FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Restaurant owners can update own restaurants"
  ON restaurants FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admin can update restaurants"
  ON restaurants FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

CREATE POLICY "Restaurant owners can delete own restaurants"
  ON restaurants FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Admin can delete restaurants"
  ON restaurants FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));