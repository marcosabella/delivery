/*
  Add restaurant table reservations.

  Restaurant owners can register reservations with customer contact data,
  reservation date/time, optional party size, optional assigned table, notes,
  and a simple lifecycle status.
*/

CREATE TABLE IF NOT EXISTS public.restaurant_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  customer_name text NOT NULL CHECK (char_length(trim(customer_name)) > 0),
  customer_phone text,
  customer_email text,
  reservation_at timestamptz NOT NULL,
  party_size integer CHECK (party_size IS NULL OR party_size > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_restaurant_date
  ON public.restaurant_reservations(restaurant_id, reservation_at);

CREATE INDEX IF NOT EXISTS idx_restaurant_reservations_status
  ON public.restaurant_reservations(restaurant_id, status);

CREATE OR REPLACE FUNCTION public.ensure_reservation_table_matches_restaurant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.restaurant_tables
    WHERE restaurant_tables.id = NEW.table_id
    AND restaurant_tables.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'The selected table does not belong to this restaurant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_reservation_table_guard ON public.restaurant_reservations;
CREATE TRIGGER restaurant_reservation_table_guard
  BEFORE INSERT OR UPDATE OF restaurant_id, table_id
  ON public.restaurant_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_reservation_table_matches_restaurant();

ALTER TABLE public.restaurant_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Restaurant owners can view own reservations" ON public.restaurant_reservations;
CREATE POLICY "Restaurant owners can view own reservations"
  ON public.restaurant_reservations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_reservations.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can insert own reservations" ON public.restaurant_reservations;
CREATE POLICY "Restaurant owners can insert own reservations"
  ON public.restaurant_reservations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_reservations.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can update own reservations" ON public.restaurant_reservations;
CREATE POLICY "Restaurant owners can update own reservations"
  ON public.restaurant_reservations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_reservations.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_reservations.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners can delete own reservations" ON public.restaurant_reservations;
CREATE POLICY "Restaurant owners can delete own reservations"
  ON public.restaurant_reservations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_reservations.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );
