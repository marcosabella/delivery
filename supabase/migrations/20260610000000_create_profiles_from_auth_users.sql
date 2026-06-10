/*
  Create profiles independently of the browser session. Email confirmation can
  leave sign-up without an authenticated session, so a client-side insert is
  not reliable under RLS.
*/

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text;
BEGIN
  requested_role := NEW.raw_user_meta_data ->> 'role';

  IF lower(COALESCE(NEW.email, '')) = 'admin@admin.com' THEN
    requested_role := 'admin';
  ELSIF requested_role NOT IN ('customer', 'restaurant_owner') THEN
    requested_role := 'customer';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), NEW.email, 'Usuario'),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), ''),
    requested_role
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
        phone = COALESCE(public.profiles.phone, EXCLUDED.phone),
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

INSERT INTO public.profiles (id, email, full_name, phone, role)
SELECT
  users.id,
  COALESCE(users.email, ''),
  COALESCE(NULLIF(trim(users.raw_user_meta_data ->> 'full_name'), ''), users.email, 'Usuario'),
  NULLIF(trim(users.raw_user_meta_data ->> 'phone'), ''),
  CASE
    WHEN lower(COALESCE(users.email, '')) = 'admin@admin.com' THEN 'admin'
    WHEN users.raw_user_meta_data ->> 'role' = 'restaurant_owner' THEN 'restaurant_owner'
    ELSE 'customer'
  END
FROM auth.users AS users
LEFT JOIN public.profiles AS profiles ON profiles.id = users.id
WHERE profiles.id IS NULL;
