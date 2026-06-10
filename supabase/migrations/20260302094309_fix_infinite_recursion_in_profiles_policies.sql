/*
  # Fix infinite recursion in profiles RLS policies

  ## Problem
  The admin policies were causing infinite recursion by selecting from profiles
  within a policy applied to profiles. This prevented any authenticated user
  from reading their own profile.

  ## Solution
  Simplify the policies to avoid subqueries on the same table. Use a helper
  function to check admin status that's marked as STABLE and SECURITY DEFINER.

  ## Changes
  - Drop problematic policies that referenced profiles table within policies
  - Create a simple admin check function
  - Rewrite policies using the helper function
*/

-- Create a helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role = 'admin'
  FROM profiles
  WHERE id = user_id;
$$;

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
DROP POLICY IF EXISTS "Admin can create user profiles" ON profiles;

-- Recreate simplified policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admin can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

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
  WITH CHECK (is_admin(auth.uid()));
