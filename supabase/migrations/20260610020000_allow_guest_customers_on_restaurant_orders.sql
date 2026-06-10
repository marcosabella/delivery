/*
  Allow restaurant staff to create orders for customers without system accounts.
  Registered customers remain linked through customer_id; guests are identified
  only by the name entered for that order.
*/

ALTER TABLE public.orders
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS guest_customer_name text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_customer_identity_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_identity_check
  CHECK (
    customer_id IS NOT NULL
    OR NULLIF(trim(guest_customer_name), '') IS NOT NULL
  );

