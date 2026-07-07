import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, Restaurant, MenuItem, Order, Profile } from '../lib/supabase';
import { useGeolocation } from '../hooks/useGeolocation';
import { addDefaultLocality } from '../lib/address';
import { customerOrderStatusLabels, getCustomerOrderStatusMessage, getOrderNotificationPermissionState, OrderNotificationPermissionState, requestOrderNotificationPermission, shouldNotifyCustomerOrderStatus, showOrderBrowserNotification } from '../lib/orderStatusNotifications';
import { LogOut, Store, ShoppingCart, Clock, MapPin, Search, X, User, AlertCircle, CheckCircle, Home, Pencil, Menu, BellRing, Heart } from 'lucide-react';
import { MessageModal } from './MessageModal';

type RestaurantPromotionItem = {
  id: string;
  menu_item_id: string;
  quantity: number;
  menu_item?: Pick<MenuItem, 'id' | 'name' | 'price' | 'category'> | null;
};

type RestaurantPromotion = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  category: string | null;
  image_url: string | null;
  name: string;
  description: string | null;
  promotion_type: 'combo' | 'discount';
  discount_type: 'fixed_price' | 'percentage' | 'amount';
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  items?: RestaurantPromotionItem[];
};

type MenuCartItem = MenuItem & { quantity: number; itemType?: 'menu_item' };
type PromotionCartItem = {
  id: string;
  promotionId: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category_id: string | null;
  category: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
  quantity: number;
  itemType: 'promotion';
};
type CartItem = MenuCartItem | PromotionCartItem;
type DeliveryMethod = 'delivery' | 'pickup';
const CART_STORAGE_KEY = 'food-delivery-cart';
const RESTAURANT_STORAGE_KEY = 'food-delivery-restaurant';

function readStoredCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]') as CartItem[];
  } catch {
    return [];
  }
}

function readStoredRestaurant(): Restaurant | null {
  try {
    return JSON.parse(localStorage.getItem(RESTAURANT_STORAGE_KEY) || 'null') as Restaurant | null;
  } catch {
    return null;
  }
}

function isPromotionCurrent(promotion: Pick<RestaurantPromotion, 'is_active' | 'starts_at' | 'ends_at'>) {
  if (!promotion.is_active) return false;

  const now = new Date();
  if (promotion.starts_at && new Date(promotion.starts_at) > now) return false;
  if (promotion.ends_at && new Date(promotion.ends_at) < now) return false;

  return true;
}

function getDiscountedPrice(price: number, promotion: Pick<RestaurantPromotion, 'discount_type' | 'discount_value'>) {
  const discountValue = Number(promotion.discount_value || 0);
  if (promotion.discount_type === 'fixed_price') return Math.max(0, discountValue);
  if (promotion.discount_type === 'percentage') return Math.max(0, price * (1 - discountValue / 100));
  return Math.max(0, price - discountValue);
}

function getComboBaseTotal(promotion: RestaurantPromotion) {
  return (promotion.items || []).reduce(
    (sum, item) => sum + Number(item.menu_item?.price || 0) * item.quantity,
    0,
  );
}

function promotionToCartItem(promotion: RestaurantPromotion): PromotionCartItem {
  return {
    id: `promotion:${promotion.id}`,
    promotionId: promotion.id,
    restaurant_id: promotion.restaurant_id,
    name: promotion.name,
    description: promotion.description,
    price: promotion.discount_type === 'fixed_price'
      ? Number(promotion.discount_value)
      : getDiscountedPrice(getComboBaseTotal(promotion), promotion),
    image_url: promotion.image_url,
    category_id: promotion.category_id,
    category: promotion.category,
    is_available: promotion.is_active,
    created_at: promotion.created_at,
    updated_at: promotion.updated_at,
    quantity: 1,
    itemType: 'promotion',
  };
}

export function CustomerDashboard() {
  const { profile, signOut } = useAuth();
  const { getCurrentLocation, location, error: geoError, loading: geoLoading } = useGeolocation();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(readStoredRestaurant);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [promotions, setPromotions] = useState<RestaurantPromotion[]>([]);
  const [cart, setCart] = useState<CartItem[]>(readStoredCart);
  const [orders, setOrders] = useState<Order[]>([]);
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<Set<string>>(() => new Set());
  const [favoriteMenuItemIds, setFavoriteMenuItemIds] = useState<Set<string>>(() => new Set());
  const [favoriteMenuItems, setFavoriteMenuItems] = useState<MenuItem[]>([]);
  const [showProfile, setShowProfile] = useState(false);
  const [activeView, setActiveView] = useState<'restaurants' | 'cart' | 'favorites' | 'orders'>('restaurants');
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [confirmedLocation, setConfirmedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [addressSource, setAddressSource] = useState<'profile' | 'manual' | 'geolocation'>('profile');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ message: string; type: 'error' | 'info' | 'success' } | null>(null);
  const [statusNotification, setStatusNotification] = useState<{ orderId: string; message: string } | null>(null);
  const didPrefillAddress = useRef(false);
  const knownOrderStatusesRef = useRef<Map<string, Order['status']>>(new Map());
  const hasLoadedOrdersRef = useRef(false);

  useEffect(() => {
    loadRestaurants();
    if (profile?.id) {
      loadOrders();
      loadFavorites();
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`customer-orders-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${profile.id}` }, () => void loadOrders())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id]);

  useEffect(() => {
    if (!statusNotification) return;
    const timeoutId = window.setTimeout(() => setStatusNotification(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [statusNotification]);

  useEffect(() => {
    if (!didPrefillAddress.current && profile?.delivery_address) {
      setDeliveryAddress(profile.delivery_address);
      setAddressSource('profile');
      didPrefillAddress.current = true;
    }
  }, [profile?.delivery_address]);

  useEffect(() => {
    if (selectedRestaurant) {
      loadMenuItems();
      loadPromotions();
    }
  }, [selectedRestaurant]);

  async function loadRestaurants() {
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (data) setRestaurants(data);
  }

  async function loadMenuItems() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.id)
      .eq('is_available', true)
      .order('category', { ascending: true });

    if (data) setMenuItems(data);
  }

  async function loadPromotions() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('restaurant_promotions')
      .select(`
        *,
        items:restaurant_promotion_items (
          id,
          menu_item_id,
          quantity,
          menu_item:menu_items (id, name, price, category)
        )
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .eq('is_active', true)
      .eq('promotion_type', 'combo')
      .order('category', { ascending: true });

    setPromotions(((data || []) as unknown as RestaurantPromotion[]).filter(isPromotionCurrent));
  }

  async function loadOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', profile!.id)
      .order('created_at', { ascending: false });

    if (!data) return;

    const previousStatuses = knownOrderStatusesRef.current;
    const isRefreshAfterInitialLoad = hasLoadedOrdersRef.current;
    const changedOrder = (data as Order[]).find((order) => {
      const previousStatus = previousStatuses.get(order.id);
      return previousStatus && previousStatus !== order.status && shouldNotifyCustomerOrderStatus(order.status);
    });

    knownOrderStatusesRef.current = new Map((data as Order[]).map((order) => [order.id, order.status]));
    hasLoadedOrdersRef.current = true;

    if (isRefreshAfterInitialLoad && changedOrder) {
      const message = getCustomerOrderStatusMessage(changedOrder);
      setStatusNotification({ orderId: changedOrder.id, message });
      showOrderBrowserNotification(changedOrder);
    }

    setOrders(data);
  }

  async function loadFavorites() {
    if (!profile?.id) return;

    const [{ data: restaurantFavorites }, { data: menuItemFavorites }] = await Promise.all([
      supabase
        .from('customer_favorite_restaurants')
        .select('restaurant_id')
        .eq('customer_id', profile.id),
      supabase
        .from('customer_favorite_menu_items')
        .select('menu_item_id')
        .eq('customer_id', profile.id),
    ]);

    setFavoriteRestaurantIds(new Set((restaurantFavorites || []).map((favorite) => favorite.restaurant_id as string)));
    const menuItemIds = (menuItemFavorites || []).map((favorite) => favorite.menu_item_id as string);
    setFavoriteMenuItemIds(new Set(menuItemIds));

    if (menuItemIds.length === 0) {
      setFavoriteMenuItems([]);
      return;
    }

    const { data: favoriteItems } = await supabase
      .from('menu_items')
      .select('*')
      .in('id', menuItemIds)
      .eq('is_available', true)
      .order('name', { ascending: true });

    setFavoriteMenuItems((favoriteItems || []) as MenuItem[]);
  }

  async function toggleFavoriteRestaurant(restaurantId: string) {
    if (!profile?.id) return;

    const wasFavorite = favoriteRestaurantIds.has(restaurantId);
    setFavoriteRestaurantIds((current) => {
      const next = new Set(current);
      if (wasFavorite) {
        next.delete(restaurantId);
      } else {
        next.add(restaurantId);
      }
      return next;
    });

    const { error } = wasFavorite
      ? await supabase
          .from('customer_favorite_restaurants')
          .delete()
          .eq('customer_id', profile.id)
          .eq('restaurant_id', restaurantId)
      : await supabase
          .from('customer_favorite_restaurants')
          .insert({ customer_id: profile.id, restaurant_id: restaurantId });

    if (error) {
      setFavoriteRestaurantIds((current) => {
        const next = new Set(current);
        if (wasFavorite) {
          next.add(restaurantId);
        } else {
          next.delete(restaurantId);
        }
        return next;
      });
      setModalMessage({ type: 'error', message: 'No se pudo actualizar el restaurante favorito.' });
    }
  }

  async function toggleFavoriteMenuItem(menuItemId: string) {
    if (!profile?.id) return;

    const wasFavorite = favoriteMenuItemIds.has(menuItemId);
    setFavoriteMenuItemIds((current) => {
      const next = new Set(current);
      if (wasFavorite) {
        next.delete(menuItemId);
      } else {
        next.add(menuItemId);
      }
      return next;
    });
    setFavoriteMenuItems((current) => {
      if (wasFavorite) return current.filter((item) => item.id !== menuItemId);
      const item = menuItems.find((menuItem) => menuItem.id === menuItemId);
      return item && !current.some((favorite) => favorite.id === menuItemId)
        ? [...current, item].sort((a, b) => a.name.localeCompare(b.name))
        : current;
    });

    const { error } = wasFavorite
      ? await supabase
          .from('customer_favorite_menu_items')
          .delete()
          .eq('customer_id', profile.id)
          .eq('menu_item_id', menuItemId)
      : await supabase
          .from('customer_favorite_menu_items')
          .insert({ customer_id: profile.id, menu_item_id: menuItemId });

    if (error) {
      setFavoriteMenuItemIds((current) => {
        const next = new Set(current);
        if (wasFavorite) {
          next.add(menuItemId);
        } else {
          next.delete(menuItemId);
        }
        return next;
      });
      await loadFavorites();
      setModalMessage({ type: 'error', message: 'No se pudo actualizar el producto favorito.' });
    }
  }

  function addToCart(item: MenuItem | PromotionCartItem) {
    const existing = cart.find((i) => i.id === item.id);
    if (existing) {
      setCart(cart.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setCart([...cart, { ...item, quantity: 1 } as CartItem]);
    }
  }

  function removeFromCart(itemId: string) {
    setCart(cart.filter((i) => i.id !== itemId));
  }

  function updateQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(itemId);
    } else {
      setCart(cart.map((i) => (i.id === itemId ? { ...i, quantity } : i)));
    }
  }

  function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  async function handleRequestLocation() {
    const loc = await getCurrentLocation();
    if (loc) {
      setConfirmedLocation({ lat: loc.latitude, lng: loc.longitude });
      setShowLocationConfirm(true);
    }
  }

  function handleUseProfileAddress() {
    if (!profile?.delivery_address) return;
    setDeliveryAddress(profile.delivery_address);
    setConfirmedLocation(null);
    setAddressSource('profile');
  }

  function handleManualAddressChange(value: string) {
    setDeliveryAddress(value);
    setConfirmedLocation(null);
    setAddressSource(value === profile?.delivery_address ? 'profile' : 'manual');
  }

  function handleDeliveryMethodChange(method: DeliveryMethod) {
    setDeliveryMethod(method);
    if (method === 'pickup') {
      setConfirmedLocation(null);
      setShowLocationConfirm(false);
    }
  }

  async function handleCheckout(addressOverride?: string, locationOverride?: { lat: number; lng: number } | null) {
    if (!selectedRestaurant || cart.length === 0) {
      setModalMessage({ type: 'info', message: 'Por favor agrega productos al carrito.' });
      return;
    }

    const isPickup = deliveryMethod === 'pickup';
    const enteredAddress = isPickup
      ? selectedRestaurant.address?.trim() || 'Retira en restaurante'
      : (addressOverride ?? deliveryAddress).trim();
    const locationToSave = isPickup
      ? null
      : locationOverride === undefined ? confirmedLocation : locationOverride;

    if (!isPickup && !enteredAddress) {
      setModalMessage({ type: 'info', message: 'Por favor ingresa una dirección de entrega.' });
      return;
    }

    let addressToSave = enteredAddress;
    if (!isPickup) {
      const currentLocation = location?.locality ? location : await getCurrentLocation();
      addressToSave = addDefaultLocality(enteredAddress, currentLocation?.locality);
    }

    const orderItems = cart.map((item) => item.itemType === 'promotion'
      ? { promotionId: item.promotionId, quantity: item.quantity }
      : { menuItemId: item.id, quantity: item.quantity });

    const { data, error: orderError } = await supabase.functions.invoke('restaurant-orders', {
      body: {
        restaurantId: selectedRestaurant.id,
        customer: {
          id: profile!.id,
          fullName: profile?.full_name || profile?.email || 'Cliente',
          email: profile?.email || '',
          phone: profile?.phone || '',
        },
        deliveryMethod,
        deliveryAddress: addressToSave,
        latitude: locationToSave?.lat ?? null,
        longitude: locationToSave?.lng ?? null,
        items: orderItems,
      },
    });

    if (orderError || data?.error) {
      setModalMessage({ type: 'error', message: 'No se pudo crear el pedido.' });
      return;
    }

    setCart([]);
    localStorage.removeItem(CART_STORAGE_KEY);
    localStorage.removeItem(RESTAURANT_STORAGE_KEY);
    setActiveView('orders');
    void requestOrderNotificationPermission();
    setDeliveryMethod('delivery');
    setDeliveryAddress(profile?.delivery_address || '');
    setAddressSource(profile?.delivery_address ? 'profile' : 'manual');
    setShowLocationConfirm(false);
    setConfirmedLocation(null);
    loadOrders();
    setModalMessage({ type: 'success', message: 'Pedido realizado con éxito.' });
  }

  const filteredRestaurants = restaurants
    .filter((r) => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const favoriteDiff = Number(favoriteRestaurantIds.has(b.id)) - Number(favoriteRestaurantIds.has(a.id));
      return favoriteDiff || a.name.localeCompare(b.name);
    });

  const catalogMenuItems: MenuCartItem[] = menuItems.map((item) => ({ ...item, quantity: 1, itemType: 'menu_item' }));
  const comboItems = promotions.map(promotionToCartItem);
  const sortedCatalogItems = [...catalogMenuItems, ...comboItems].sort((a, b) => {
    const aFavorite = a.itemType !== 'promotion' && favoriteMenuItemIds.has(a.id);
    const bFavorite = b.itemType !== 'promotion' && favoriteMenuItemIds.has(b.id);
    const favoriteDiff = Number(bFavorite) - Number(aFavorite);
    return favoriteDiff || (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
  });
  const favoriteRestaurants = restaurants
    .filter((restaurant) => favoriteRestaurantIds.has(restaurant.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const statusColors: Record<Order['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    preparing: 'bg-orange-100 text-orange-800',
    delivering: 'bg-cyan-100 text-cyan-800',
    delivered: 'bg-green-100 text-green-800',
    closed: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-red-100 text-red-800',
  };

  const statusLabels: Record<Order['status'], string> = {
    ...customerOrderStatusLabels,
  };

  const customerNavItems = [
    { id: 'restaurants' as const, label: 'Restaurantes', icon: Store },
    { id: 'cart' as const, label: 'Carrito', icon: ShoppingCart },
    { id: 'favorites' as const, label: 'Favoritos', icon: Heart },
    { id: 'orders' as const, label: 'Pedidos', icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:flex">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500">
            <Store className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Food Delivery</p>
            <p className="text-xs text-slate-500">Pedidos online</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {customerNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveView(item.id);
                  if (item.id === 'orders') void requestOrderNotificationPermission();
                }}
                className={`relative flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                  isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
                {item.id === 'cart' && cart.length > 0 && (
                  <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{cart.length}</span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <User className="h-4 w-4 shrink-0" />
            Perfil
          </button>
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate px-2 pb-2 text-xs text-slate-500">{profile?.full_name}</p>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Salir
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 lg:pl-60">
        <div
          className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity lg:hidden ${
            isMobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 lg:hidden ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          aria-label="Menu movil"
        >
          <div className="flex h-14 items-center justify-between gap-3 border-b border-slate-200 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-orange-500">
                <Store className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">Food Delivery</p>
                <p className="truncate text-xs text-slate-500">Pedidos online</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(false)}
              className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100"
              aria-label="Cerrar menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {customerNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveView(item.id);
                    if (item.id === 'orders') void requestOrderNotificationPermission();
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`relative flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                    isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.id === 'cart' && cart.length > 0 && (
                    <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{cart.length}</span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => {
                setShowProfile(!showProfile);
                setIsMobileSidebarOpen(false);
              }}
              className="flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <User className="h-4 w-4 shrink-0" />
              Perfil
            </button>
          </nav>
          <div className="border-t border-slate-200 p-3">
            <p className="truncate px-2 pb-2 text-xs text-slate-500">{profile?.full_name}</p>
            <button
              onClick={() => {
                setIsMobileSidebarOpen(false);
                signOut();
              }}
              className="flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Salir
            </button>
          </div>
        </aside>

        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
          <div className="flex min-h-14 items-center justify-between gap-3 px-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="rounded-md p-2 text-slate-600 transition hover:bg-slate-100"
                aria-label="Abrir menu"
                aria-expanded={isMobileSidebarOpen}
              >
                <Menu className="h-5 w-5" />
              </button>
              <Store className="h-5 w-5 text-orange-500" />
              <span className="text-sm font-semibold">Food Delivery</span>
            </div>
            <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        {statusNotification && (
          <div className="fixed right-3 top-16 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-orange-200 bg-white p-4 shadow-lg sm:right-5">
            <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Actualizacion de pedido</p>
              <p className="mt-1 text-sm text-slate-600">{statusNotification.message}</p>
            </div>
            <button type="button" onClick={() => setStatusNotification(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar notificacion">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {activeView === 'cart' ? (
          <div>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="mb-1 text-xl font-semibold text-gray-800">Tu Carrito</h1>
                <p className="text-sm text-gray-600">Revisa productos, cantidades y datos de entrega antes de confirmar.</p>
              </div>
              <button
                onClick={() => setActiveView('restaurants')}
                className="self-start rounded-md border border-orange-200 px-3 py-2 text-sm font-medium text-orange-600 transition hover:bg-orange-50 sm:self-auto"
              >
                Seguir comprando
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="rounded-lg bg-white p-8 text-center shadow-sm">
                <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-gray-600">Tu carrito estÃ¡ vacÃ­o</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
                <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 text-gray-600">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold">Producto</th>
                          <th className="px-4 py-3 text-left font-semibold">CategorÃ­a</th>
                          <th className="px-4 py-3 text-right font-semibold">Precio</th>
                          <th className="px-4 py-3 text-center font-semibold">Cantidad</th>
                          <th className="px-4 py-3 text-right font-semibold">Subtotal</th>
                          <th className="px-4 py-3 text-center font-semibold">Quitar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {cart.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-4 py-4">
                              <div className="font-semibold text-gray-800">{item.name}</div>
                              <div className="text-gray-500 line-clamp-1">{item.description}</div>
                            </td>
                            <td className="px-4 py-4 text-gray-600">{item.category || '-'}</td>
                            <td className="px-4 py-4 text-right font-medium text-gray-800">${item.price}</td>
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                  className="w-8 h-8 border rounded-lg hover:bg-gray-100 transition"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center font-medium">{item.quantity}</span>
                                <button
                                  onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                  className="w-8 h-8 border rounded-lg hover:bg-gray-100 transition"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right font-semibold text-gray-800">
                              ${(item.price * item.quantity).toFixed(2)}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button
                                onClick={() => removeFromCart(item.id)}
                                className="inline-flex items-center justify-center w-8 h-8 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                                aria-label={`Quitar ${item.name}`}
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="h-fit rounded-lg bg-white p-4 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold text-gray-800">Resumen</h2>
                  <div className="space-y-3 mb-6 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Productos</span>
                      <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
                    </div>
                    <div className="flex justify-between text-xl font-bold border-t pt-3">
                      <span>Total</span>
                      <span className="text-orange-500">${getCartTotal().toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="mb-4 space-y-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Modalidad
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleDeliveryMethodChange('delivery')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                          deliveryMethod === 'delivery'
                            ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Home className="w-4 h-4" />
                        Entrega
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeliveryMethodChange('pickup')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                          deliveryMethod === 'pickup'
                            ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Store className="w-4 h-4" />
                        Retira en restaurante
                      </button>
                    </div>
                    {deliveryMethod === 'pickup' && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                        Vas a retirar el pedido en {selectedRestaurant?.name}. {selectedRestaurant?.address ? `Dirección: ${selectedRestaurant.address}` : 'El restaurante no tiene dirección cargada.'}
                      </div>
                    )}
                  </div>

                  {deliveryMethod === 'delivery' && (
                  <div className="mb-4 space-y-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      DirecciÃ³n de entrega
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      {addressSource === 'profile'
                        ? 'Se usa la dirección cargada en tu perfil.'
                        : addressSource === 'geolocation'
                          ? 'Se usará la dirección obtenida por ubicación.'
                          : 'Esta dirección solo aplica a este pedido.'}
                    </p>
                    {profile?.delivery_address && deliveryAddress !== profile.delivery_address && (
                      <button
                        type="button"
                        onClick={handleUseProfileAddress}
                        className="mb-2 inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition"
                      >
                        <Home className="w-4 h-4" />
                        Usar perfil
                      </button>
                    )}
                    {!profile?.delivery_address && (
                      <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                        No tenés una dirección cargada en tu perfil. Podés escribir una para este pedido o geolocalizarte.
                      </div>
                    )}
                    <textarea
                      value={deliveryAddress}
                      onChange={(e) => handleManualAddressChange(e.target.value)}
                      placeholder="Ingresa tu direcciÃ³n completa"
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-base resize-none"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmedLocation(null);
                          setAddressSource('manual');
                        }}
                        className="w-full border border-gray-300 hover:bg-gray-50 text-gray-700 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                      >
                        <Pencil className="w-4 h-4" />
                        Escribir dirección
                      </button>
                      <button
                        type="button"
                        onClick={handleRequestLocation}
                        disabled={geoLoading}
                        className="w-full border border-orange-200 bg-orange-50 hover:bg-orange-100 disabled:opacity-60 text-orange-700 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                      >
                        <MapPin className="w-4 h-4" />
                        {geoLoading ? 'Ubicando...' : 'Geolocalizar'}
                      </button>
                    </div>
                    {geoError && (
                      <p className="text-sm text-red-600">{geoError}</p>
                    )}
                  </div>
                  )}

                  <button
                    onClick={() => handleCheckout()}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Realizar pedido
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : activeView === 'favorites' ? (
          <div>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="mb-1 text-xl font-semibold text-gray-800">Favoritos</h1>
                <p className="text-gray-600">Tus restaurantes y productos guardados para pedir mas rapido.</p>
              </div>
              <button
                onClick={() => setActiveView('restaurants')}
                className="self-start sm:self-auto px-4 py-2 text-sm font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition"
              >
                Ver restaurantes
              </button>
            </div>

            {favoriteRestaurants.length === 0 && favoriteMenuItems.length === 0 ? (
              <div className="rounded-lg bg-white p-8 text-center shadow-sm">
                <Heart className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-gray-600">Todavia no tenes favoritos</p>
              </div>
            ) : (
              <div className="space-y-8">
                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-800">Restaurantes favoritos</h2>
                    <span className="text-sm text-gray-500">{favoriteRestaurants.length}</span>
                  </div>
                  {favoriteRestaurants.length === 0 ? (
                    <div className="rounded-lg bg-white p-6 text-center text-gray-500 shadow-sm">
                      No guardaste restaurantes favoritos.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {favoriteRestaurants.map((restaurant) => (
                        <div
                          key={restaurant.id}
                          onClick={() => {
                            setSelectedRestaurant(restaurant);
                            setActiveView('restaurants');
                          }}
                          className="group cursor-pointer overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md"
                        >
                          <div className="relative flex h-28 items-center justify-center bg-slate-100">
                            <Store className="h-8 w-8 text-slate-400" />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleFavoriteRestaurant(restaurant.id);
                              }}
                              className="absolute right-3 top-3 rounded-full bg-red-500 p-2 text-white shadow-sm transition hover:bg-red-600"
                              aria-label="Quitar restaurante de favoritos"
                            >
                              <Heart className="h-4 w-4 fill-current" />
                            </button>
                          </div>
                          <div className="p-4">
                            <h3 className="mb-1 font-semibold text-gray-800 transition group-hover:text-orange-500">
                              {restaurant.name}
                            </h3>
                            <p className="mb-3 line-clamp-2 text-sm text-gray-600">{restaurant.description}</p>
                            <div className="flex items-center text-sm text-gray-500">
                              <MapPin className="mr-1 h-4 w-4" />
                              {restaurant.address}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-800">Productos favoritos</h2>
                    <span className="text-sm text-gray-500">{favoriteMenuItems.length}</span>
                  </div>
                  {favoriteMenuItems.length === 0 ? (
                    <div className="rounded-lg bg-white p-6 text-center text-gray-500 shadow-sm">
                      No guardaste productos favoritos.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {favoriteMenuItems.map((item) => {
                        const restaurant = restaurants.find((current) => current.id === item.restaurant_id);
                        return (
                          <div key={item.id} className="overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md">
                            <div className="relative flex h-24 items-center justify-center bg-slate-100">
                              <Store className="h-7 w-7 text-slate-400" />
                              <button
                                type="button"
                                onClick={() => void toggleFavoriteMenuItem(item.id)}
                                className="absolute right-3 top-3 rounded-full bg-red-500 p-2 text-white shadow-sm transition hover:bg-red-600"
                                aria-label="Quitar producto de favoritos"
                              >
                                <Heart className="h-4 w-4 fill-current" />
                              </button>
                            </div>
                            <div className="p-4">
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h3 className="font-bold text-gray-800">{item.name}</h3>
                                  <p className="truncate text-xs font-semibold text-orange-600">{restaurant?.name || 'Restaurante'}</p>
                                </div>
                                {item.category && (
                                  <span className="shrink-0 rounded bg-orange-100 px-2 py-1 text-xs text-orange-700">
                                    {item.category}
                                  </span>
                                )}
                              </div>
                              <p className="mb-4 line-clamp-2 text-sm text-gray-600">{item.description}</p>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-lg font-semibold text-orange-500">${item.price}</span>
                                <button
                                  onClick={() => {
                                    if (!restaurant) {
                                      setModalMessage({ type: 'error', message: 'No se encontro el restaurante del producto.' });
                                      return;
                                    }
                                    setSelectedRestaurant(restaurant);
                                    addToCart(item);
                                  }}
                                  className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-white transition hover:bg-orange-600"
                                >
                                  Agregar
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        ) : activeView === 'orders' ? (
          <div>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="mb-1 text-xl font-semibold text-gray-800">Mis Pedidos</h1>
                <p className="text-gray-600">Consulta el estado, fecha, direcciÃ³n y total de cada pedido.</p>
              </div>
              <button
                onClick={() => setActiveView('restaurants')}
                className="self-start sm:self-auto px-4 py-2 text-sm font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition"
              >
                Ver restaurantes
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="rounded-lg bg-white p-8 text-center shadow-sm">
                <Clock className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-gray-600">No tienes pedidos aÃºn</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Pedido</th>
                        <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                        <th className="px-4 py-3 text-left font-semibold">DirecciÃ³n</th>
                        <th className="px-4 py-3 text-center font-semibold">Estado</th>
                        <th className="px-4 py-3 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {orders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-4 font-semibold text-gray-800">#{order.id.slice(0, 8)}</td>
                          <td className="px-4 py-4 text-gray-600 whitespace-nowrap">
                            {new Date(order.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-4 text-gray-600 min-w-64">
                            <div className="flex items-center gap-2">
                              {order.delivery_method === 'pickup' ? (
                                <Store className="w-4 h-4 shrink-0 text-gray-400" />
                              ) : (
                                <MapPin className="w-4 h-4 shrink-0 text-gray-400" />
                              )}
                              <span>
                                {order.delivery_method === 'pickup'
                                  ? `Retira en restaurante${order.delivery_address ? ` - ${order.delivery_address}` : ''}`
                                  : order.delivery_address}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span className={`inline-block text-xs px-3 py-1 rounded-full font-medium ${statusColors[order.status]}`}>
                              {statusLabels[order.status]}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-lg font-bold text-orange-500">
                            ${order.total_amount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : !selectedRestaurant ? (
          <div>
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-gray-800 mb-2">Descubre restaurantes increíbles</h1>
              <p className="text-gray-600">Pide tu comida favorita desde la comodidad de tu hogar</p>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar restaurantes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {filteredRestaurants.length === 0 ? (
              <div className="text-center py-12">
                <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No se encontraron restaurantes</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredRestaurants.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    onClick={() => setSelectedRestaurant(restaurant)}
                    className="group cursor-pointer overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md"
                  >
                    <div className="relative flex h-28 items-center justify-center bg-slate-100">
                      <Store className="h-8 w-8 text-slate-400" />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleFavoriteRestaurant(restaurant.id);
                        }}
                        className={`absolute right-3 top-3 rounded-full p-2 shadow-sm transition ${
                          favoriteRestaurantIds.has(restaurant.id)
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'bg-white text-slate-500 hover:bg-red-50 hover:text-red-500'
                        }`}
                        aria-label={favoriteRestaurantIds.has(restaurant.id) ? 'Quitar restaurante de favoritos' : 'Agregar restaurante a favoritos'}
                      >
                        <Heart className={`h-4 w-4 ${favoriteRestaurantIds.has(restaurant.id) ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                    <div className="p-4">
                      <div className="mb-1 flex items-start gap-2">
                        <h3 className="min-w-0 flex-1 font-semibold text-gray-800 transition group-hover:text-orange-500">
                          {restaurant.name}
                        </h3>
                        {favoriteRestaurantIds.has(restaurant.id) && (
                          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                            Favorito
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 text-sm mb-3 line-clamp-2">{restaurant.description}</p>
                      <div className="flex items-center text-sm text-gray-500">
                        <MapPin className="w-4 h-4 mr-1" />
                        {restaurant.address}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button
              onClick={() => setSelectedRestaurant(null)}
              className="mb-6 text-orange-500 hover:text-orange-600 font-medium"
            >
              ← Volver a restaurantes
            </button>

            <div className="mb-4 rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="mb-1 text-xl font-semibold text-gray-800">{selectedRestaurant.name}</h1>
                  <p className="text-gray-600 mb-2">{selectedRestaurant.description}</p>
                  <div className="flex items-center text-sm text-gray-500">
                    <MapPin className="w-4 h-4 mr-1" />
                    {selectedRestaurant.address}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleFavoriteRestaurant(selectedRestaurant.id)}
                  className={`shrink-0 rounded-full p-2 transition ${
                    favoriteRestaurantIds.has(selectedRestaurant.id)
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500'
                  }`}
                  aria-label={favoriteRestaurantIds.has(selectedRestaurant.id) ? 'Quitar restaurante de favoritos' : 'Agregar restaurante a favoritos'}
                >
                  <Heart className={`h-5 w-5 ${favoriteRestaurantIds.has(selectedRestaurant.id) ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>

            {sortedCatalogItems.length === 0 ? (
              <div className="rounded-lg bg-white py-8 text-center">
                <p className="text-gray-600">Este restaurante no tiene elementos en el menú aún</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sortedCatalogItems.map((item) => {
                  const isPromotion = item.itemType === 'promotion';
                  return (
                  <div key={item.id} className="overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md">
                    <div className="relative flex h-24 items-center justify-center bg-slate-100">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <Store className="h-7 w-7 text-slate-400" />
                      )}
                      {isPromotion ? (
                        <span className="absolute right-3 top-3 rounded-full bg-orange-500 px-2 py-1 text-xs font-semibold text-white">Combo</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void toggleFavoriteMenuItem(item.id)}
                          className={`absolute right-3 top-3 rounded-full p-2 shadow-sm transition ${
                            favoriteMenuItemIds.has(item.id)
                              ? 'bg-red-500 text-white hover:bg-red-600'
                              : 'bg-white text-slate-500 hover:bg-red-50 hover:text-red-500'
                          }`}
                          aria-label={favoriteMenuItemIds.has(item.id) ? 'Quitar producto de favoritos' : 'Agregar producto a favoritos'}
                        >
                          <Heart className={`h-4 w-4 ${favoriteMenuItemIds.has(item.id) ? 'fill-current' : ''}`} />
                        </button>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-gray-800 flex-1">{item.name}</h3>
                        {!isPromotion && favoriteMenuItemIds.has(item.id) ? (
                          <span className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                            Favorito
                          </span>
                        ) : item.category && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                            {item.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-4 line-clamp-2">{item.description}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-semibold text-orange-500">${item.price}</span>
                        <button
                          onClick={() => addToCart(item)}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition"
                        >
                          Agregar
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </main>
      </div>

      {showProfile && profile && (
        <ProfileEditForm profile={profile} onClose={() => setShowProfile(false)} />
      )}

      {showLocationConfirm && location && (
        <LocationConfirmationModal
          location={location}
          geoError={geoError}
          onConfirm={(address) => {
            setDeliveryAddress(address);
            setAddressSource('geolocation');
            setShowLocationConfirm(false);
          }}
          onCancel={() => setShowLocationConfirm(false)}
          onUseManual={() => {
            setShowLocationConfirm(false);
            setConfirmedLocation(null);
            setAddressSource('manual');
          }}
        />
      )}

      {modalMessage && (
        <MessageModal
          type={modalMessage.type}
          message={modalMessage.message}
          onClose={() => setModalMessage(null)}
        />
      )}
    </div>
  );
}

function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      Math.pow(2, zoom)
  );
}

function MapView({ latitude, longitude }: { latitude: number; longitude: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [loadError] = useState(false);

  const ZOOM = 16;
  const TILE_SIZE = 256;
  const VIEW_TILES = 3;

  const centerTileX = lon2tile(longitude, ZOOM);
  const centerTileY = lat2tile(latitude, ZOOM);

  const pixelX = Math.floor(
    (((longitude + 180) / 360) * Math.pow(2, ZOOM) - centerTileX) * TILE_SIZE
  );
  const pixelY = Math.floor(
    ((1 -
      Math.log(
        Math.tan((latitude * Math.PI) / 180) + 1 / Math.cos((latitude * Math.PI) / 180)
      ) /
        Math.PI) /
      2) *
      Math.pow(2, ZOOM) -
      centerTileY
  ) * TILE_SIZE;

  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const halfW = width / 2;
    const halfH = height / 2;

    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, width, height);

    const tilesToLoad: HTMLImageElement[] = [];
    let loaded = 0;
    const totalTiles = VIEW_TILES * VIEW_TILES;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = centerTileX + dx;
        const ty = centerTileY + dy;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`;

        const drawX = halfW + dx * TILE_SIZE - pixelX;
        const drawY = halfH + dy * TILE_SIZE - pixelY;

        img.onload = () => {
          ctx.drawImage(img, drawX, drawY, TILE_SIZE, TILE_SIZE);
          loaded++;
          if (loaded === totalTiles) {
            drawMarker(ctx, halfW, halfH);
            setTilesLoaded(true);
          }
        };

        img.onerror = () => {
          loaded++;
          if (loaded === totalTiles) {
            drawMarker(ctx, halfW, halfH);
            setTilesLoaded(true);
          }
        };

        tilesToLoad.push(img);
      }
    }

    if (totalTiles === 0) {
      drawMarker(ctx, halfW, halfH);
      setTilesLoaded(true);
    }
  }, [latitude, longitude, centerTileX, centerTileY, pixelX, pixelY]);

  function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fill();
  }

  useEffect(() => {
    drawMap();
  }, [drawMap]);

  return (
    <div className="relative h-64 bg-gray-100">
      {!tilesLoaded && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
          <div className="flex items-center gap-2 text-gray-500">
            <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            Cargando mapa...
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={VIEW_TILES * TILE_SIZE}
        height={VIEW_TILES * TILE_SIZE}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-2 right-2 bg-white bg-opacity-90 px-2 py-1 rounded text-xs text-gray-500">
        OpenStreetMap
      </div>
    </div>
  );
}

interface LocationConfirmationModalProps {
  location: { latitude: number; longitude: number; address?: string; locality?: string; country?: string };
  geoError: string | null;
  onConfirm: (address: string) => void;
  onCancel: () => void;
  onUseManual: () => void;
}

function LocationConfirmationModal({
  location,
  geoError,
  onConfirm,
  onCancel,
  onUseManual,
}: LocationConfirmationModalProps) {
  const [loading, setLoading] = useState(false);
  const suggestedAddress = [location.address, location.locality].filter(Boolean).join(', ');
  const [editableAddress, setEditableAddress] = useState(suggestedAddress || '');

  const handleConfirm = async () => {
    if (!editableAddress.trim()) return;
    setLoading(true);
    await onConfirm(editableAddress.trim());
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        {geoError ? (
          <>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 text-center mb-2">Error de ubicación</h2>
            <p className="text-gray-600 text-center mb-6">{geoError}</p>
            <button
              onClick={onUseManual}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg font-medium transition"
            >
              Usar dirección manual
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mx-auto mb-4">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 text-center mb-2">Confirmar tu ubicación</h2>

            <div className="rounded-lg overflow-hidden mb-4 border border-gray-200">
              <MapView latitude={location.latitude} longitude={location.longitude} />
            </div>

            <p className="text-xs text-gray-500 text-center mb-4">
              Coordenadas GPS: {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dirección de entrega
              </label>
              <input
                type="text"
                value={editableAddress}
                onChange={(e) => setEditableAddress(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-base"
                placeholder="Corregí tu dirección si es necesario"
              />
              <p className="text-xs text-gray-500 mt-1">
                Si la dirección no es exacta, corregila manualmente. Las coordenadas GPS se guardarán igual.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || !editableAddress.trim()}
                className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg font-medium transition"
              >
                {loading ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>

            <button
              onClick={onUseManual}
              className="w-full mt-3 text-sm text-gray-600 hover:text-gray-800 py-2"
            >
              Usar dirección manual en su lugar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileEditForm({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [formData, setFormData] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
    delivery_address: profile.delivery_address || '',
  });
  const [notificationPermission, setNotificationPermission] = useState<OrderNotificationPermissionState>(() => getOrderNotificationPermissionState());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleNotificationPermission() {
    const permission = await requestOrderNotificationPermission();
    setNotificationPermission(permission);
  }

  const notificationStatus = {
    granted: {
      label: 'Activadas',
      description: 'Vas a recibir avisos cuando cambie el estado de tus pedidos. Podés revalidar este dispositivo si cambiaste de navegador.',
      button: 'Revalidar dispositivo',
      disabled: false,
      className: 'bg-green-100 text-green-700',
    },
    default: {
      label: 'Pendientes',
      description: 'Activalas para recibir avisos del estado de tus pedidos en este dispositivo.',
      button: 'Activar notificaciones',
      disabled: false,
      className: 'bg-orange-100 text-orange-700',
    },
    denied: {
      label: 'Bloqueadas',
      description: 'El navegador las tiene bloqueadas. Habilitalas desde los permisos del sitio.',
      button: 'Permiso bloqueado',
      disabled: true,
      className: 'bg-red-100 text-red-700',
    },
    registration_failed: {
      label: 'Reintentar',
      description: 'El permiso esta activo, pero no se pudo registrar este dispositivo.',
      button: 'Reintentar activacion',
      disabled: false,
      className: 'bg-red-100 text-red-700',
    },
    unsupported: {
      label: 'No disponibles',
      description: 'Este navegador no permite Push Web o falta configurar las claves de notificaciones.',
      button: 'No disponible',
      disabled: true,
      className: 'bg-slate-100 text-slate-600',
    },
  } satisfies Record<OrderNotificationPermissionState, { label: string; description: string; button: string; disabled: boolean; className: string }>;

  const currentNotificationStatus = notificationStatus[notificationPermission];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name.trim(),
          phone: formData.phone.trim() || null,
          delivery_address: formData.delivery_address.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id)
        .select()
        .single();

      if (error) {
        console.error('Update error:', error);
        setMessage('Error al guardar los cambios');
        return;
      }

      setMessage('Perfil actualizado exitosamente');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1200);
    } catch (err) {
      console.error('Exception:', err);
      setMessage('Error al guardar los cambios');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Editar Perfil</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo</label>
            <input
              type="text"
              required
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dirección de Entrega</label>
            <textarea
              value={formData.delivery_address}
              onChange={(e) => setFormData({ ...formData, delivery_address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              rows={3}
              placeholder="Tu dirección completa"
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-gray-800">Notificaciones de pedidos</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${currentNotificationStatus.className}`}>{currentNotificationStatus.label}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{currentNotificationStatus.description}</p>
                <button
                  type="button"
                  onClick={() => void handleNotificationPermission()}
                  disabled={currentNotificationStatus.disabled}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {currentNotificationStatus.button}
                </button>
              </div>
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {message}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
