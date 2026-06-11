DROP POLICY IF EXISTS "Anyone can view active restaurants" ON restaurants;
CREATE POLICY "Anyone can view active restaurants"
  ON restaurants FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR owner_id = auth.uid());

DROP POLICY IF EXISTS "Anyone can view available menu items" ON menu_items;
CREATE POLICY "Anyone can view available menu items"
  ON menu_items FOR SELECT
  TO anon, authenticated
  USING (
    is_available = true OR
    EXISTS (
      SELECT 1 FROM restaurants
      WHERE restaurants.id = menu_items.restaurant_id
      AND restaurants.owner_id = auth.uid()
    )
  );
