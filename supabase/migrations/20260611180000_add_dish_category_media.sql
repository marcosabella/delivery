ALTER TABLE public.dish_categories
  ADD COLUMN description text,
  ADD COLUMN image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'category-images',
  'category-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Anyone can view category images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'category-images');

CREATE POLICY "Admins can upload category images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'category-images' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can update category images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'category-images' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'category-images' AND public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete category images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'category-images' AND public.is_admin(auth.uid()));
