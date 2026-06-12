CREATE TABLE IF NOT EXISTS favorite_restaurants (
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS favorite_menu_items (
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_favorite_restaurants_restaurant
  ON favorite_restaurants(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_favorite_menu_items_menu_item
  ON favorite_menu_items(menu_item_id);

ALTER TABLE favorite_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorite_menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own favorite restaurants"
  ON favorite_restaurants
  FOR ALL
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'customer'
    )
  );

CREATE POLICY "Customers manage own favorite menu items"
  ON favorite_menu_items
  FOR ALL
  TO authenticated
  USING (customer_id = auth.uid())
  WITH CHECK (
    customer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'customer'
    )
  );
