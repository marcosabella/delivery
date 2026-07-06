/*
  Track the waiter who creates or updates an in-restaurant table order.
*/

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS waiter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_waiter
  ON public.orders(waiter_id);
