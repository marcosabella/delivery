/*
  Remove the profiles -> orders -> profiles RLS cycle introduced by the
  restaurant-owner customer lookup policy.
*/

DROP POLICY IF EXISTS "Restaurant owners can view customer profiles for their orders"
  ON public.profiles;

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

CREATE POLICY "Restaurant owners can view customer profiles for their orders"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.restaurant_owner_can_view_customer(auth.uid(), id));
