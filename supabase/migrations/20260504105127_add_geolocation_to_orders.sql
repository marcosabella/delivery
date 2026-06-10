/*
  # Add geolocation to orders

  1. Changes
    - Add `latitude` column to orders table for storing customer's delivery location
    - Add `longitude` column to orders table for storing customer's delivery location
  
  2. Details
    - Both columns are nullable (decimal type with 8 decimal places for precision)
    - Used for delivery tracking and mapping customer locations
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'latitude'
  ) THEN
    ALTER TABLE orders ADD COLUMN latitude decimal(10, 8);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'longitude'
  ) THEN
    ALTER TABLE orders ADD COLUMN longitude decimal(11, 8);
  END IF;
END $$;
