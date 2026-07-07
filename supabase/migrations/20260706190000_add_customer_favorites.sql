CREATE TABLE IF NOT EXISTS customer_favorite_restaurants (
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (customer_id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS customer_favorite_menu_items (
  customer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (customer_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_favorite_restaurants_restaurant
  ON customer_favorite_restaurants(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_customer_favorite_menu_items_menu_item
  ON customer_favorite_menu_items(menu_item_id);

ALTER TABLE customer_favorite_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_favorite_menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own favorite restaurants"
  ON customer_favorite_restaurants FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Customers can add own favorite restaurants"
  ON customer_favorite_restaurants FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers can remove own favorite restaurants"
  ON customer_favorite_restaurants FOR DELETE
  TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Customers can view own favorite menu items"
  ON customer_favorite_menu_items FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

CREATE POLICY "Customers can add own favorite menu items"
  ON customer_favorite_menu_items FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Customers can remove own favorite menu items"
  ON customer_favorite_menu_items FOR DELETE
  TO authenticated
  USING (customer_id = auth.uid());
