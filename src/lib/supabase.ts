import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  delivery_address: string | null;
  role: 'customer' | 'restaurant_owner' | 'admin' | 'driver' | 'waiter';
  created_at: string;
  updated_at: string;
};

export type Restaurant = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RestaurantTable = {
  id: string;
  restaurant_id: string;
  table_number: number;
  label: string | null;
  seats: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RestaurantReservation = {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  reservation_at: string;
  party_size: number | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RestaurantWaiter = {
  restaurant_id: string;
  waiter_id: string;
  is_active: boolean;
  created_at: string;
};

export type MenuItem = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category_id: string;
  category: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
};

export type DishCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  customer_id: string | null;
  guest_customer_name: string | null;
  restaurant_id: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'delivering' | 'delivered' | 'closed' | 'cancelled';
  delivery_method: 'delivery' | 'pickup' | 'dine_in';
  dining_table_id: string | null;
  total_amount: number;
  delivery_address: string;
  waiter_id: string | null;
  latitude: number | null;
  longitude: number | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type DeliveryRoute = {
  id: string;
  restaurant_id: string;
  driver_id: string;
  created_by: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
