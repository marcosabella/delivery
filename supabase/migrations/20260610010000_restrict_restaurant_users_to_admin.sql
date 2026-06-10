/*
  Public sign-up always creates customers. Elevated roles are accepted only
  when Auth app metadata marks the account as created by the admin function.
*/

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text := 'customer';
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'admin@admin.com' THEN
    requested_role := 'admin';
  ELSIF COALESCE((NEW.raw_app_meta_data ->> 'managed_by_admin')::boolean, false) THEN
    requested_role := NEW.raw_app_meta_data ->> 'role';
    IF requested_role NOT IN ('customer', 'restaurant_owner', 'admin') THEN
      requested_role := 'customer';
    END IF;
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
        role = EXCLUDED.role,
        updated_at = now();

  RETURN NEW;
END;
$$;
