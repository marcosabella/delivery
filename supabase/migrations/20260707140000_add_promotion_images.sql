ALTER TABLE public.restaurant_promotions
  ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'promotion-images',
  'promotion-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Anyone can view promotion images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'promotion-images');

CREATE POLICY "Restaurant owners can upload promotion images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'promotion-images'
    AND EXISTS (
      SELECT 1
      FROM public.restaurants
      WHERE restaurants.id::text = (storage.foldername(name))[1]
      AND restaurants.owner_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners can update promotion images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'promotion-images'
    AND EXISTS (
      SELECT 1
      FROM public.restaurants
      WHERE restaurants.id::text = (storage.foldername(name))[1]
      AND restaurants.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'promotion-images'
    AND EXISTS (
      SELECT 1
      FROM public.restaurants
      WHERE restaurants.id::text = (storage.foldername(name))[1]
      AND restaurants.owner_id = auth.uid()
    )
  );

CREATE POLICY "Restaurant owners can delete promotion images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'promotion-images'
    AND EXISTS (
      SELECT 1
      FROM public.restaurants
      WHERE restaurants.id::text = (storage.foldername(name))[1]
      AND restaurants.owner_id = auth.uid()
    )
  );
