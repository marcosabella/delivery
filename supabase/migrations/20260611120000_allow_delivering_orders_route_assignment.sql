/* Allow restaurant owners to recover delivery orders that were moved to
   delivering before a route sheet was assigned. */

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
      AND (o.restaurant_id <> target_restaurant_id OR o.delivery_method <> 'delivery' OR o.status NOT IN ('confirmed', 'preparing', 'delivering'))
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

GRANT EXECUTE ON FUNCTION public.assign_delivery_route(uuid, uuid, uuid[]) TO authenticated;
