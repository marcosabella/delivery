/*
  Add a separate closed state for dine-in tables.

  Delivered keeps meaning "the waiter brought the order to the table"; closed
  frees the table after payment/service is finished.
*/

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'closed', 'cancelled'));
