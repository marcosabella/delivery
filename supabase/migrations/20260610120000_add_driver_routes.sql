/* Driver accounts, assigned route sheets and delivery audit trail. */

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'restaurant_owner', 'admin', 'driver'));

CREATE TABLE public.restaurant_drivers (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, driver_id)
);

CREATE TABLE public.delivery_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.delivery_route_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  stop_sequence integer NOT NULL CHECK (stop_sequence > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  delivered_at timestamptz,
  delivery_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, order_id),
  UNIQUE (route_id, stop_sequence)
);

CREATE TABLE public.delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
  route_order_id uuid REFERENCES public.delivery_route_orders(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id),
  event_type text NOT NULL CHECK (event_type IN ('route_assigned', 'route_started', 'order_delivered', 'delivery_failed', 'route_completed')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_restaurant_drivers_driver ON public.restaurant_drivers(driver_id);
CREATE INDEX idx_delivery_routes_restaurant ON public.delivery_routes(restaurant_id, created_at DESC);
CREATE INDEX idx_delivery_routes_driver ON public.delivery_routes(driver_id, created_at DESC);
CREATE INDEX idx_delivery_route_orders_route ON public.delivery_route_orders(route_id, stop_sequence);
CREATE INDEX idx_delivery_route_orders_order ON public.delivery_route_orders(order_id);
CREATE INDEX idx_delivery_events_route ON public.delivery_events(route_id, created_at);

ALTER TABLE public.restaurant_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.owns_restaurant(target_restaurant_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.restaurants WHERE id = target_restaurant_id AND owner_id = target_user_id);
$$;

CREATE OR REPLACE FUNCTION public.drives_for_restaurant(target_restaurant_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_drivers
    WHERE restaurant_id = target_restaurant_id AND driver_id = target_user_id AND is_active
  );
$$;

REVOKE ALL ON FUNCTION public.owns_restaurant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.drives_for_restaurant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_restaurant(uuid, uuid), public.drives_for_restaurant(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_can_view_order(target_order_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_route_orders route_order
    JOIN public.delivery_routes route ON route.id = route_order.route_id
    WHERE route_order.order_id = target_order_id AND route.driver_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_can_view_customer(target_customer_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders order_record
    JOIN public.delivery_route_orders route_order ON route_order.order_id = order_record.id
    JOIN public.delivery_routes route ON route.id = route_order.route_id
    WHERE order_record.customer_id = target_customer_id AND route.driver_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.restaurant_owner_can_view_driver(target_driver_id uuid, target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_drivers assignment
    JOIN public.restaurants restaurant ON restaurant.id = assignment.restaurant_id
    WHERE assignment.driver_id = target_driver_id AND restaurant.owner_id = target_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.driver_can_view_order(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_can_view_customer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restaurant_owner_can_view_driver(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_can_view_order(uuid, uuid), public.driver_can_view_customer(uuid, uuid), public.restaurant_owner_can_view_driver(uuid, uuid) TO authenticated;

CREATE POLICY "Restaurant owners and drivers view driver assignments" ON public.restaurant_drivers
FOR SELECT TO authenticated USING (
  public.owns_restaurant(restaurant_id, auth.uid()) OR driver_id = auth.uid()
);

CREATE POLICY "Restaurant owners manage driver assignments" ON public.restaurant_drivers
FOR ALL TO authenticated USING (public.owns_restaurant(restaurant_id, auth.uid()))
WITH CHECK (public.owns_restaurant(restaurant_id, auth.uid()));

CREATE POLICY "Route participants view routes" ON public.delivery_routes
FOR SELECT TO authenticated USING (
  public.owns_restaurant(restaurant_id, auth.uid()) OR driver_id = auth.uid()
);

CREATE POLICY "Route participants view route orders" ON public.delivery_route_orders
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.delivery_routes route
    WHERE route.id = route_id
      AND (public.owns_restaurant(route.restaurant_id, auth.uid()) OR route.driver_id = auth.uid())
  )
);

CREATE POLICY "Route participants view events" ON public.delivery_events
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.delivery_routes route
    WHERE route.id = route_id
      AND (public.owns_restaurant(route.restaurant_id, auth.uid()) OR route.driver_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Anyone can view active restaurants" ON public.restaurants;
CREATE POLICY "Users can view accessible restaurants" ON public.restaurants FOR SELECT TO authenticated USING (
  is_active = true OR owner_id = auth.uid() OR public.drives_for_restaurant(id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "Customers can view own orders" ON public.orders;
CREATE POLICY "Users can view accessible orders" ON public.orders FOR SELECT TO authenticated USING (
  customer_id = auth.uid()
  OR public.owns_restaurant(restaurant_id, auth.uid())
  OR public.driver_can_view_order(id, auth.uid())
);

CREATE POLICY "Drivers can view delivery customers" ON public.profiles FOR SELECT TO authenticated USING (
  public.driver_can_view_customer(id, auth.uid())
);

CREATE POLICY "Restaurant owners can view assigned drivers" ON public.profiles FOR SELECT TO authenticated USING (
  public.restaurant_owner_can_view_driver(id, auth.uid())
);

CREATE POLICY "Drivers can view assigned order items" ON public.order_items FOR SELECT TO authenticated USING (
  public.driver_can_view_order(order_id, auth.uid())
);

CREATE OR REPLACE FUNCTION public.assign_delivery_route(
  target_restaurant_id uuid,
  target_driver_id uuid,
  target_order_ids uuid[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_route_id uuid; order_id uuid; position integer := 0;
BEGIN
  IF NOT public.owns_restaurant(target_restaurant_id, auth.uid()) THEN RAISE EXCEPTION 'Restaurant access denied'; END IF;
  IF COALESCE(array_length(target_order_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one order'; END IF;
  IF NOT public.drives_for_restaurant(target_restaurant_id, target_driver_id) THEN RAISE EXCEPTION 'Driver is not active for this restaurant'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = ANY(target_order_ids)
      AND (o.restaurant_id <> target_restaurant_id OR o.delivery_method <> 'delivery' OR o.status NOT IN ('confirmed', 'preparing'))
  ) OR (SELECT count(*) FROM public.orders WHERE id = ANY(target_order_ids)) <> array_length(target_order_ids, 1) THEN
    RAISE EXCEPTION 'One or more orders cannot be assigned';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_route_orders dro JOIN public.delivery_routes dr ON dr.id = dro.route_id
    WHERE dro.order_id = ANY(target_order_ids) AND dr.status IN ('assigned', 'in_progress')
  ) THEN RAISE EXCEPTION 'One or more orders already have an active route'; END IF;

  INSERT INTO public.delivery_routes (restaurant_id, driver_id, created_by)
  VALUES (target_restaurant_id, target_driver_id, auth.uid()) RETURNING id INTO new_route_id;
  FOREACH order_id IN ARRAY target_order_ids LOOP
    position := position + 1;
    INSERT INTO public.delivery_route_orders (route_id, order_id, stop_sequence) VALUES (new_route_id, order_id, position);
  END LOOP;
  UPDATE public.orders SET status = 'delivering', updated_at = now() WHERE id = ANY(target_order_ids);
  INSERT INTO public.delivery_events (route_id, event_type, actor_id, notes)
  VALUES (new_route_id, 'route_assigned', auth.uid(), format('%s pedidos asignados', position));
  RETURN new_route_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_delivery_route(target_route_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.delivery_routes SET status = 'in_progress', started_at = COALESCE(started_at, now()), updated_at = now()
  WHERE id = target_route_id AND driver_id = auth.uid() AND status = 'assigned';
  IF NOT FOUND THEN RAISE EXCEPTION 'Route cannot be started'; END IF;
  INSERT INTO public.delivery_events (route_id, event_type, actor_id) VALUES (target_route_id, 'route_started', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_route_order(target_route_order_id uuid, target_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE selected_route_order public.delivery_route_orders%ROWTYPE; selected_route public.delivery_routes%ROWTYPE;
BEGIN
  SELECT * INTO selected_route_order FROM public.delivery_route_orders WHERE id = target_route_order_id;
  SELECT * INTO selected_route FROM public.delivery_routes WHERE id = selected_route_order.route_id;
  IF selected_route.driver_id <> auth.uid() OR selected_route.status NOT IN ('assigned', 'in_progress') THEN RAISE EXCEPTION 'Delivery access denied'; END IF;
  IF selected_route_order.status <> 'pending' THEN RAISE EXCEPTION 'Delivery is already closed'; END IF;

  UPDATE public.delivery_routes SET status = 'in_progress', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = selected_route.id;
  UPDATE public.delivery_route_orders SET status = 'delivered', delivered_at = now(), delivery_notes = NULLIF(trim(target_notes), ''), updated_at = now() WHERE id = target_route_order_id;
  UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = selected_route_order.order_id;
  INSERT INTO public.delivery_events (route_id, route_order_id, order_id, event_type, actor_id, notes)
  VALUES (selected_route.id, target_route_order_id, selected_route_order.order_id, 'order_delivered', auth.uid(), NULLIF(trim(target_notes), ''));

  IF NOT EXISTS (SELECT 1 FROM public.delivery_route_orders WHERE route_id = selected_route.id AND status = 'pending') THEN
    UPDATE public.delivery_routes SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = selected_route.id;
    INSERT INTO public.delivery_events (route_id, event_type, actor_id) VALUES (selected_route.id, 'route_completed', auth.uid());
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_delivery_route(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_delivery_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_route_order(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested_role text := 'customer';
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'admin@admin.com' THEN requested_role := 'admin';
  ELSIF COALESCE((NEW.raw_app_meta_data ->> 'managed_by_admin')::boolean, false) THEN
    requested_role := NEW.raw_app_meta_data ->> 'role';
    IF requested_role NOT IN ('customer', 'restaurant_owner', 'admin', 'driver') THEN requested_role := 'customer'; END IF;
  END IF;
  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (NEW.id, COALESCE(NEW.email, ''), COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), NEW.email, 'Usuario'), NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), ''), requested_role)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name), phone = COALESCE(public.profiles.phone, EXCLUDED.phone), role = EXCLUDED.role, updated_at = now();
  RETURN NEW;
END;
$$;
