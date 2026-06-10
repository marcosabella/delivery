/*
  # Add delivery address to profiles

  1. Changes
    - Add `delivery_address` column to `profiles` table for storing customer delivery addresses
    
  2. Details
    - Column is nullable to maintain backward compatibility with existing profiles
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'delivery_address'
  ) THEN
    ALTER TABLE profiles ADD COLUMN delivery_address text;
  END IF;
END $$;