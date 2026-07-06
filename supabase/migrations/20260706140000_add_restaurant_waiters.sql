/*
  Add restaurant waiters.

  Waiters are restaurant-scoped users who can register and edit dine-in table
  orders from a mobile panel.
*/

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'restaurant_owner', 'admin', 'driver', 'waiter'));

CREATE TABLE IF NOT EXISTS public.restaurant_waiters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  waiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, waiter_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_waiters_waiter
  ON public.restaurant_waiters(waiter_id);

ALTER TABLE public.restaurant_waiters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.waits_for_restaurant(target_restaurant_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_waiters
    WHERE restaurant_id = target_restaurant_id AND waiter_id = target_user_id AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.restaurant_owner_can_view_waiter(target_waiter_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_waiters assignment
    JOIN public.restaurants restaurant ON restaurant.id = assignment.restaurant_id
    WHERE assignment.waiter_id = target_waiter_id AND restaurant.owner_id = target_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.waits_for_restaurant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restaurant_owner_can_view_waiter(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waits_for_restaurant(uuid, uuid), public.restaurant_owner_can_view_waiter(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Restaurant owners and waiters view waiter assignments" ON public.restaurant_waiters;
CREATE POLICY "Restaurant owners and waiters view waiter assignments"
  ON public.restaurant_waiters FOR SELECT
  TO authenticated
  USING (public.owns_restaurant(restaurant_id, auth.uid()) OR waiter_id = auth.uid());

DROP POLICY IF EXISTS "Restaurant owners manage waiter assignments" ON public.restaurant_waiters;
CREATE POLICY "Restaurant owners manage waiter assignments"
  ON public.restaurant_waiters FOR ALL
  TO authenticated
  USING (public.owns_restaurant(restaurant_id, auth.uid()))
  WITH CHECK (public.owns_restaurant(restaurant_id, auth.uid()));

DROP POLICY IF EXISTS "Users can view accessible restaurants" ON public.restaurants;
CREATE POLICY "Users can view accessible restaurants" ON public.restaurants FOR SELECT TO authenticated USING (
  is_active = true
  OR owner_id = auth.uid()
  OR public.drives_for_restaurant(id, auth.uid())
  OR public.waits_for_restaurant(id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "Users can view accessible orders" ON public.orders;
CREATE POLICY "Users can view accessible orders" ON public.orders FOR SELECT TO authenticated USING (
  customer_id = auth.uid()
  OR public.owns_restaurant(restaurant_id, auth.uid())
  OR public.driver_can_view_order(id, auth.uid())
  OR public.waits_for_restaurant(restaurant_id, auth.uid())
);

DROP POLICY IF EXISTS "Waiters can view assigned restaurant tables" ON public.restaurant_tables;
CREATE POLICY "Waiters can view assigned restaurant tables"
  ON public.restaurant_tables FOR SELECT
  TO authenticated
  USING (public.waits_for_restaurant(restaurant_id, auth.uid()));

DROP POLICY IF EXISTS "Waiters can view table order items" ON public.order_items;
CREATE POLICY "Waiters can view table order items" ON public.order_items FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
      AND public.waits_for_restaurant(orders.restaurant_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "Restaurant owners can view assigned waiters" ON public.profiles;
CREATE POLICY "Restaurant owners can view assigned waiters" ON public.profiles FOR SELECT TO authenticated USING (
  public.restaurant_owner_can_view_waiter(id, auth.uid())
);

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested_role text := 'customer';
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'admin@admin.com' THEN requested_role := 'admin';
  ELSIF COALESCE((NEW.raw_app_meta_data ->> 'managed_by_admin')::boolean, false) THEN
    requested_role := NEW.raw_app_meta_data ->> 'role';
    IF requested_role NOT IN ('customer', 'restaurant_owner', 'admin', 'driver', 'waiter') THEN requested_role := 'customer'; END IF;
  END IF;
  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), NEW.email, 'Usuario'), NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), ''), requested_role)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name), phone = COALESCE(public.profiles.phone, EXCLUDED.phone), role = EXCLUDED.role, updated_at = now();
  RETURN NEW;
END;
$$;
