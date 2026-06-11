/*
  Global dish categories shared by every restaurant.

  The legacy menu_items.category text is kept synchronized for compatibility
  with existing order views and stored cart data.
*/

CREATE TABLE public.dish_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dish_categories_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX dish_categories_name_unique_ci
  ON public.dish_categories (lower(btrim(name)));

ALTER TABLE public.dish_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view dish categories"
  ON public.dish_categories FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can insert dish categories"
  ON public.dish_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update dish categories"
  ON public.dish_categories FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete dish categories"
  ON public.dish_categories FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

INSERT INTO public.dish_categories (name, slug, sort_order) VALUES
  ('Entradas', 'entradas', 10),
  ('Platos principales', 'platos-principales', 20),
  ('Hamburguesas', 'hamburguesas', 30),
  ('Pizzas', 'pizzas', 40),
  ('Pastas', 'pastas', 50),
  ('Carnes', 'carnes', 60),
  ('Pollo', 'pollo', 70),
  ('Pescados y mariscos', 'pescados-y-mariscos', 80),
  ('Ensaladas', 'ensaladas', 90),
  ('Sandwiches y wraps', 'sandwiches-y-wraps', 100),
  ('Guarniciones', 'guarniciones', 110),
  ('Combos', 'combos', 120),
  ('Postres', 'postres', 130),
  ('Bebidas', 'bebidas', 140),
  ('Otros', 'otros', 999);

ALTER TABLE public.menu_items
  ADD COLUMN category_id uuid REFERENCES public.dish_categories(id) ON DELETE RESTRICT;

UPDATE public.menu_items AS item
SET category_id = category.id
FROM public.dish_categories AS category
WHERE category.slug = CASE
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('entrada', 'entradas', 'aperitivo', 'aperitivos') THEN 'entradas'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('plato principal', 'platos principales', 'principal', 'principales') THEN 'platos-principales'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('hamburguesa', 'hamburguesas') THEN 'hamburguesas'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('pizza', 'pizzas') THEN 'pizzas'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('pasta', 'pastas') THEN 'pastas'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('carne', 'carnes', 'parrilla') THEN 'carnes'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('pollo', 'pollos') THEN 'pollo'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('pescado', 'pescados', 'marisco', 'mariscos', 'pescados y mariscos') THEN 'pescados-y-mariscos'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('ensalada', 'ensaladas') THEN 'ensaladas'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('sandwich', 'sandwiches', 'sándwich', 'sándwiches', 'wrap', 'wraps') THEN 'sandwiches-y-wraps'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('guarnicion', 'guarniciones', 'guarnición', 'acompañamiento', 'acompañamientos') THEN 'guarniciones'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('combo', 'combos', 'promocion', 'promociones', 'promoción') THEN 'combos'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('postre', 'postres', 'dulce', 'dulces') THEN 'postres'
  WHEN lower(btrim(COALESCE(item.category, ''))) IN ('bebida', 'bebidas', 'drink', 'drinks') THEN 'bebidas'
  ELSE 'otros'
END;

ALTER TABLE public.menu_items
  ALTER COLUMN category_id SET NOT NULL;

CREATE INDEX idx_menu_items_category_id ON public.menu_items(category_id);

CREATE OR REPLACE FUNCTION public.sync_menu_item_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT name INTO NEW.category
  FROM public.dish_categories
  WHERE id = NEW.category_id;

  IF NEW.category IS NULL THEN
    RAISE EXCEPTION 'La categoria seleccionada no existe';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_menu_item_category_before_write
  BEFORE INSERT OR UPDATE OF category_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_menu_item_category();

CREATE OR REPLACE FUNCTION public.sync_category_name_to_menu_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.menu_items
    SET category = NEW.name,
        updated_at = now()
    WHERE category_id = NEW.id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_category_name_after_update
  BEFORE UPDATE ON public.dish_categories
  FOR EACH ROW EXECUTE FUNCTION public.sync_category_name_to_menu_items();
