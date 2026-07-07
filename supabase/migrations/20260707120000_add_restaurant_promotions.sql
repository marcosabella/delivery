CREATE TABLE IF NOT EXISTS public.restaurant_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  promotion_type text NOT NULL CHECK (promotion_type IN ('combo', 'discount')),
  discount_type text NOT NULL CHECK (discount_type IN ('fixed_price', 'percentage', 'amount')),
  discount_value decimal(10,2) NOT NULL CHECK (discount_value >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.restaurant_promotion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.restaurant_promotions(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promotion_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_promotions_restaurant
  ON public.restaurant_promotions(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_restaurant_promotions_active_dates
  ON public.restaurant_promotions(is_active, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_restaurant_promotion_items_promotion
  ON public.restaurant_promotion_items(promotion_id);

CREATE INDEX IF NOT EXISTS idx_restaurant_promotion_items_menu_item
  ON public.restaurant_promotion_items(menu_item_id);

ALTER TABLE public.restaurant_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_promotion_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Restaurant owners manage promotions" ON public.restaurant_promotions;
CREATE POLICY "Restaurant owners manage promotions"
  ON public.restaurant_promotions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_promotions.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_promotions.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view active promotions" ON public.restaurant_promotions;
CREATE POLICY "Users can view active promotions"
  ON public.restaurant_promotions FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.restaurants
      WHERE restaurants.id = restaurant_promotions.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Restaurant owners manage promotion items" ON public.restaurant_promotion_items;
CREATE POLICY "Restaurant owners manage promotion items"
  ON public.restaurant_promotion_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.restaurant_promotions promotion
      JOIN public.restaurants restaurant ON restaurant.id = promotion.restaurant_id
      WHERE promotion.id = restaurant_promotion_items.promotion_id
      AND restaurant.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.restaurant_promotions promotion
      JOIN public.restaurants restaurant ON restaurant.id = promotion.restaurant_id
      WHERE promotion.id = restaurant_promotion_items.promotion_id
      AND restaurant.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view active promotion items" ON public.restaurant_promotion_items;
CREATE POLICY "Users can view active promotion items"
  ON public.restaurant_promotion_items FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.restaurant_promotions promotion
      JOIN public.restaurants restaurant ON restaurant.id = promotion.restaurant_id
      WHERE promotion.id = restaurant_promotion_items.promotion_id
      AND (
        promotion.is_active = true
        OR restaurant.owner_id = auth.uid()
      )
    )
  );
