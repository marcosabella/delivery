/*
  Add in-restaurant table ordering.

  Restaurants can configure numbered tables and associate dine-in orders with
  one of those tables.
*/

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_number integer NOT NULL CHECK (table_number > 0),
  label text,
  seats integer CHECK (seats IS NULL OR seats > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, table_number)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_tables_restaurant
  ON public.restaurant_tables(restaurant_id, is_active, table_number);

ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Restaurant owners can view own tables" ON public.restaurant_tables;
CREATE POLICY "Restaurant owners can view own tables"
  ON public.restaurant_tables FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_tables.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can insert own tables" ON public.restaurant_tables;
CREATE POLICY "Restaurant owners can insert own tables"
  ON public.restaurant_tables FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_tables.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can update own tables" ON public.restaurant_tables;
CREATE POLICY "Restaurant owners can update own tables"
  ON public.restaurant_tables FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_tables.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_tables.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can delete own tables" ON public.restaurant_tables;
CREATE POLICY "Restaurant owners can delete own tables"
  ON public.restaurant_tables FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_tables.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS dining_table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_dining_table
  ON public.orders(dining_table_id);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_delivery_method_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_method_check
  CHECK (delivery_method IN ('delivery', 'pickup', 'dine_in'));

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_dine_in_table_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_dine_in_table_check
  CHECK (
    (delivery_method = 'dine_in' AND dining_table_id IS NOT NULL)
    OR (delivery_method <> 'dine_in' AND dining_table_id IS NULL)
  );

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_customer_identity_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_identity_check
  CHECK (
    delivery_method = 'dine_in'
    OR customer_id IS NOT NULL
    OR NULLIF(trim(guest_customer_name), '') IS NOT NULL
  );
