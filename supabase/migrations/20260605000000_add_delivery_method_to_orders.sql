/*
  # Add delivery method to orders

  Allows customers to choose between home delivery and pickup at the restaurant.
*/

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'delivery';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_delivery_method_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_method_check
  CHECK (delivery_method IN ('delivery', 'pickup'));
