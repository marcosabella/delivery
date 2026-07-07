ALTER TABLE public.restaurant_promotions
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.dish_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS category text;

UPDATE public.restaurant_promotions AS promotion
SET category_id = category.id,
    category = category.name
FROM public.dish_categories AS category
WHERE promotion.category_id IS NULL
  AND category.slug = CASE
    WHEN promotion.promotion_type = 'combo' THEN 'combos'
    ELSE 'otros'
  END;

CREATE INDEX IF NOT EXISTS idx_restaurant_promotions_category_id
  ON public.restaurant_promotions(category_id);

CREATE OR REPLACE FUNCTION public.sync_restaurant_promotion_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    NEW.category := NULL;
    RETURN NEW;
  END IF;

  SELECT name INTO NEW.category
  FROM public.dish_categories
  WHERE id = NEW.category_id;

  IF NEW.category IS NULL THEN
    RAISE EXCEPTION 'La categoria seleccionada no existe';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_restaurant_promotion_category_before_write ON public.restaurant_promotions;
CREATE TRIGGER sync_restaurant_promotion_category_before_write
  BEFORE INSERT OR UPDATE OF category_id ON public.restaurant_promotions
  FOR EACH ROW EXECUTE FUNCTION public.sync_restaurant_promotion_category();

CREATE OR REPLACE FUNCTION public.sync_category_name_to_restaurant_promotions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.restaurant_promotions
    SET category = NEW.name,
        updated_at = now()
    WHERE category_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_promotion_category_name_after_update ON public.dish_categories;
CREATE TRIGGER sync_promotion_category_name_after_update
  AFTER UPDATE ON public.dish_categories
  FOR EACH ROW EXECUTE FUNCTION public.sync_category_name_to_restaurant_promotions();
