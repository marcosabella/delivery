import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Clock3,
  BellRing,
  Filter,
  KeyRound,
  LogOut,
  MapPin,
  Menu,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  User,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { supabase, DishCategory, MenuItem, Order, Profile, Restaurant } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { Auth } from './Auth';
import { customerOrderStatusLabels, getCustomerOrderStatusMessage, getOrderNotificationPermissionState, OrderNotificationPermissionState, requestOrderNotificationPermission, shouldNotifyCustomerOrderStatus, showOrderBrowserNotification } from '../lib/orderStatusNotifications';

type CartItem = MenuItem & { quantity: number };
type AccountView = 'cart' | 'orders' | 'profile';

const CART_STORAGE_KEY = 'food-delivery-cart';
const RESTAURANT_STORAGE_KEY = 'food-delivery-restaurant';

function readStoredValue<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

export function Landing() {
  const { user, profile, retryProfile, signOut } = useAuth();
  const { getCurrentLocation, error: geoError, loading: geoLoading } = useGeolocation();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [dishCategories, setDishCategories] = useState<DishCategory[]>([]);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [cart, setCart] = useState<CartItem[]>(() => readStoredValue<CartItem[]>(CART_STORAGE_KEY) || []);
  const [cartRestaurant, setCartRestaurant] = useState<Restaurant | null>(() => readStoredValue<Restaurant>(RESTAURANT_STORAGE_KEY));
  const [orders, setOrders] = useState<Order[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [profileMenu, setProfileMenu] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState(profile?.delivery_address || '');
  const [deliveryLocation, setDeliveryLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [message, setMessage] = useState('');
  const [statusNotification, setStatusNotification] = useState<{ orderId: string; message: string } | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const categoryCarouselRef = useRef<HTMLDivElement>(null);
  const knownOrderStatusesRef = useRef<Map<string, Order['status']>>(new Map());
  const hasLoadedOrdersRef = useRef(false);

  function scrollCategories(direction: -1 | 1) {
    categoryCarouselRef.current?.scrollBy({
      left: direction * Math.min(categoryCarouselRef.current.clientWidth * 0.8, 720),
      behavior: 'smooth',
    });
  }

  useEffect(() => {
    function closeProfileMenu(event: MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenu(false);
    }

    function closeProfileMenuWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfileMenu(false);
    }

    document.addEventListener('mousedown', closeProfileMenu);
    document.addEventListener('keydown', closeProfileMenuWithEscape);
    return () => {
      document.removeEventListener('mousedown', closeProfileMenu);
      document.removeEventListener('keydown', closeProfileMenuWithEscape);
    };
  }, []);

  useEffect(() => {
    async function loadCatalog() {
      const [restaurantResult, menuResult, categoryResult] = await Promise.all([
        supabase.from('restaurants').select('*').eq('is_active', true).order('name'),
        supabase.from('menu_items').select('*').eq('is_available', true).order('name'),
        supabase.from('dish_categories').select('*').eq('is_active', true).order('sort_order').order('name'),
      ]);

      setRestaurants(restaurantResult.data || []);
      setMenuItems(menuResult.data || []);
      setDishCategories(categoryResult.data || []);
      setLoading(false);
    }

    void loadCatalog();
  }, []);

  useEffect(() => {
    if (profile?.delivery_address) setDeliveryAddress(profile.delivery_address);
  }, [profile?.delivery_address]);

  useEffect(() => {
    if (!profile?.id) {
      setOrders([]);
      knownOrderStatusesRef.current = new Map();
      hasLoadedOrdersRef.current = false;
      return;
    }

    void loadOrders();

    const channel = supabase
      .channel(`landing-customer-orders-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${profile.id}` }, () => void loadOrders())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id]);

  useEffect(() => {
    if (!statusNotification) return;
    const timeoutId = window.setTimeout(() => setStatusNotification(null), 7000);
    return () => window.clearTimeout(timeoutId);
  }, [statusNotification]);

  async function loadOrders() {
    if (!profile) return;
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', profile.id)
      .order('created_at', { ascending: false });

    const loadedOrders = (data || []) as Order[];
    const previousStatuses = knownOrderStatusesRef.current;
    const isRefreshAfterInitialLoad = hasLoadedOrdersRef.current;
    const changedOrder = loadedOrders.find((order) => {
      const previousStatus = previousStatuses.get(order.id);
      return previousStatus && previousStatus !== order.status && shouldNotifyCustomerOrderStatus(order.status);
    });

    knownOrderStatusesRef.current = new Map(loadedOrders.map((order) => [order.id, order.status]));
    hasLoadedOrdersRef.current = true;

    if (isRefreshAfterInitialLoad && changedOrder) {
      const statusMessage = getCustomerOrderStatusMessage(changedOrder);
      setStatusNotification({ orderId: changedOrder.id, message: statusMessage });
      showOrderBrowserNotification(changedOrder);
    }

    setOrders(loadedOrders);
  }

  async function openOrders() {
    await requestOrderNotificationPermission();
    await loadOrders();
    setAccountView('orders');
    setMobileMenu(false);
  }

  function openAccountView(view: AccountView) {
    setAccountView(view);
    setSelectedRestaurant(null);
    setProfileMenu(false);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openRestaurant(restaurant: Restaurant) {
    setSelectedRestaurant(restaurant);
    setAccountView(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const restaurantById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])),
    [restaurants],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = menuItems.filter((item) => {
    const restaurant = restaurantById.get(item.restaurant_id);
    const matchesCategory = categoryId === 'all' || item.category_id === categoryId;
    const searchable = [item.name, item.description, item.category, restaurant?.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
  });

  const filteredRestaurants = restaurants.filter((restaurant) => {
    if (!normalizedQuery) return true;
    const hasMatchingDish = menuItems.some(
      (item) => item.restaurant_id === restaurant.id && [item.name, item.category].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery),
    );
    return `${restaurant.name} ${restaurant.description || ''}`.toLowerCase().includes(normalizedQuery) || hasMatchingDish;
  });

  function addToCart(item: MenuItem) {
    const restaurant = restaurantById.get(item.restaurant_id);
    if (!restaurant) return;

    const nextCart = cartRestaurant && cartRestaurant.id !== restaurant.id
      ? [{ ...item, quantity: 1 }]
      : cart.some((cartItem) => cartItem.id === item.id)
        ? cart.map((cartItem) => cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem)
        : [...cart, { ...item, quantity: 1 }];

    setCartRestaurant(restaurant);
    setCart(nextCart);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
    localStorage.setItem(RESTAURANT_STORAGE_KEY, JSON.stringify(restaurant));
  }

  function updateQuantity(itemId: string, quantity: number) {
    const nextCart = quantity <= 0
      ? cart.filter((item) => item.id !== itemId)
      : cart.map((item) => item.id === itemId ? { ...item, quantity } : item);
    setCart(nextCart);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
    if (nextCart.length === 0) {
      setCartRestaurant(null);
      localStorage.removeItem(RESTAURANT_STORAGE_KEY);
    }
  }

  function clearCart() {
    setCart([]);
    setCartRestaurant(null);
    localStorage.removeItem(CART_STORAGE_KEY);
    localStorage.removeItem(RESTAURANT_STORAGE_KEY);
    setMessage('');
  }

  async function geolocateDeliveryAddress() {
    setMessage('');
    const location = await getCurrentLocation();
    if (!location) return;

    const detectedAddress = [location.address, location.locality].filter(Boolean).join(', ');
    setDeliveryAddress(detectedAddress || `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`);
    setDeliveryLocation({ latitude: location.latitude, longitude: location.longitude });
  }

  function updateDeliveryAddress(address: string) {
    setDeliveryAddress(address);
    setDeliveryLocation(null);
  }

  async function handleCheckout() {
    if (!profile || !cartRestaurant || cart.length === 0) return;
    const address = deliveryMethod === 'pickup'
      ? cartRestaurant.address?.trim() || 'Retira en restaurante'
      : deliveryAddress.trim();

    if (!address) {
      setMessage('Ingresa una direccion de entrega.');
      return;
    }

    setSubmittingOrder(true);
    setMessage('');
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: profile.id,
        restaurant_id: cartRestaurant.id,
        total_amount: cartTotal,
        delivery_method: deliveryMethod,
        delivery_address: address,
        status: 'pending',
        latitude: deliveryMethod === 'delivery' ? deliveryLocation?.latitude ?? null : null,
        longitude: deliveryMethod === 'delivery' ? deliveryLocation?.longitude ?? null : null,
      })
      .select()
      .single();

    if (orderError || !order) {
      setMessage('No se pudo crear el pedido. Intenta nuevamente.');
      setSubmittingOrder(false);
      return;
    }

    const { error: itemsError } = await supabase.from('order_items').insert(
      cart.map((item) => ({
        order_id: order.id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        subtotal: item.price * item.quantity,
      })),
    );

    if (itemsError) {
      setMessage('El pedido fue creado, pero no se pudo guardar su detalle.');
      setSubmittingOrder(false);
      return;
    }

    setCart([]);
    setCartRestaurant(null);
    localStorage.removeItem(CART_STORAGE_KEY);
    localStorage.removeItem(RESTAURANT_STORAGE_KEY);
    setShowCart(false);
    setSubmittingOrder(false);
    await openOrders();
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const profileLabel = profile?.full_name?.trim() || 'Mi perfil';

  return (
    <div className="min-h-screen bg-[#fffaf7] text-slate-900">
      {statusNotification && (
        <div className="fixed right-3 top-20 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-orange-200 bg-white p-4 shadow-xl sm:right-5">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Actualizacion de pedido</p>
            <p className="mt-1 text-sm text-slate-600">{statusNotification.message}</p>
          </div>
          <button type="button" onClick={() => setStatusNotification(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar notificacion">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-orange-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <a href="#inicio" onClick={() => { setAccountView(null); setSelectedRestaurant(null); }} className="flex items-center gap-2 font-bold text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-white"><UtensilsCrossed className="h-5 w-5" /></span>
            <span>Food Delivery</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#restaurantes" onClick={() => { setAccountView(null); setSelectedRestaurant(null); }} className="hover:text-orange-600">Restaurantes</a>
            <a href="#platos" onClick={() => { setAccountView(null); setSelectedRestaurant(null); }} className="hover:text-orange-600">Platos</a>
            <a href="#como-funciona" onClick={() => { setAccountView(null); setSelectedRestaurant(null); }} className="hover:text-orange-600">Como funciona</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCart(true)} className="relative rounded-xl border border-slate-200 p-2.5 text-slate-700 hover:bg-slate-50" aria-label="Abrir carrito">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-orange-500 px-1 text-center text-xs font-bold text-white">{cartCount}</span>}
            </button>
            {user ? <div ref={profileMenuRef} className="relative hidden sm:block">
              <button
                onClick={() => setProfileMenu((open) => !open)}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                aria-expanded={profileMenu}
                aria-haspopup="menu"
              >
                <User className="h-4 w-4" /> <span className="max-w-40 truncate">{profileLabel}</span>
                {cartCount > 0 && <span className="min-w-5 rounded-full bg-orange-500 px-1 text-center text-xs font-bold text-white">{cartCount}</span>}
                <ChevronDown className={`h-4 w-4 transition-transform ${profileMenu ? 'rotate-180' : ''}`} />
              </button>
              {profileMenu && <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 text-sm shadow-xl" role="menu">
                <button onClick={() => openAccountView('cart')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-700 hover:bg-orange-50 hover:text-orange-600" role="menuitem"><ShoppingBag className="h-4 w-4" /> Mi carrito {cartCount > 0 && <span className="ml-auto font-semibold">{cartCount}</span>}</button>
                <button onClick={() => { void openOrders(); setProfileMenu(false); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-700 hover:bg-orange-50 hover:text-orange-600" role="menuitem"><Clock3 className="h-4 w-4" /> Mis pedidos</button>
                <button onClick={() => openAccountView('profile')} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-700 hover:bg-orange-50 hover:text-orange-600" role="menuitem"><User className="h-4 w-4" /> Datos de mi perfil</button>
                <div className="my-2 border-t border-slate-100" />
                <button onClick={() => { setProfileMenu(false); void signOut(); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-red-600 hover:bg-red-50" role="menuitem"><LogOut className="h-4 w-4" /> Cerrar sesión</button>
              </div>}
            </div> : <button onClick={() => setShowAuth(true)} className="hidden rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 sm:flex sm:items-center sm:gap-2">
              <User className="h-4 w-4" /> Ingresar
            </button>}
            <button onClick={() => setMobileMenu(!mobileMenu)} className="rounded-xl p-2.5 md:hidden" aria-label="Menu"><Menu className="h-5 w-5" /></button>
          </div>
        </div>
        {mobileMenu && <div className="border-t bg-white px-4 py-4 md:hidden"><div className="flex flex-col gap-3 text-sm font-medium"><a href="#restaurantes" onClick={() => { setAccountView(null); setSelectedRestaurant(null); setMobileMenu(false); }}>Restaurantes</a><a href="#platos" onClick={() => { setAccountView(null); setSelectedRestaurant(null); setMobileMenu(false); }}>Platos</a>{user ? <details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1"><span className="truncate">{profileLabel}</span> <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary><div className="mt-2 flex flex-col gap-3 border-l-2 border-orange-100 pl-4"><button onClick={() => openAccountView('cart')} className="flex items-center gap-2 text-left"><ShoppingBag className="h-4 w-4" /> Mi carrito {cartCount > 0 && <span className="rounded-full bg-orange-500 px-1.5 text-xs text-white">{cartCount}</span>}</button><button onClick={openOrders} className="flex items-center gap-2 text-left"><Clock3 className="h-4 w-4" /> Mis pedidos</button><button onClick={() => openAccountView('profile')} className="flex items-center gap-2 text-left"><User className="h-4 w-4" /> Datos de mi perfil</button><button onClick={() => { setMobileMenu(false); void signOut(); }} className="flex items-center gap-2 text-left text-red-600"><LogOut className="h-4 w-4" /> Cerrar sesión</button></div></details> : <button onClick={() => setShowAuth(true)} className="text-left text-orange-600">Ingresar o registrarme</button>}</div></div>}
      </header>

      <main>
        {accountView === 'cart' ? (
          <CartView
            cart={cart}
            restaurant={cartRestaurant}
            total={cartTotal}
            deliveryMethod={deliveryMethod}
            deliveryAddress={deliveryAddress}
            message={message}
            submitting={submittingOrder}
            onBack={() => setAccountView(null)}
            onUpdateQuantity={updateQuantity}
            onClear={clearCart}
            onDeliveryMethodChange={setDeliveryMethod}
            onDeliveryAddressChange={updateDeliveryAddress}
            onGeolocate={() => void geolocateDeliveryAddress()}
            geoLoading={geoLoading}
            geoError={geoError}
            hasGeolocation={deliveryLocation !== null}
            onCheckout={handleCheckout}
          />
        ) : accountView === 'orders' ? (
          <OrdersView orders={orders} onBack={() => setAccountView(null)} />
        ) : accountView === 'profile' && profile ? (
          <ProfileView profile={profile} onBack={() => setAccountView(null)} onSaved={retryProfile} />
        ) : selectedRestaurant ? (
          <RestaurantView
            restaurant={selectedRestaurant}
            items={menuItems.filter((item) => item.restaurant_id === selectedRestaurant.id)}
            onBack={() => setSelectedRestaurant(null)}
            onAddToCart={addToCart}
          />
        ) : (
        <>
        <section id="inicio" className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-white to-amber-50">
          <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-orange-200/40 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:py-24">
            <div>
              <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-700">Tu comida favorita, cerca tuyo</span>
              <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight text-slate-900 sm:text-6xl">Todo lo que tenes ganas de comer, en un solo lugar.</h1>
              <p className="mt-5 max-w-2xl text-lg text-slate-600">Explora restaurantes, compara menus y hace tu pedido online de forma simple.</p>
              <div className="mt-8 flex max-w-2xl flex-col gap-3 rounded-2xl bg-white p-3 shadow-xl shadow-orange-200/40 sm:flex-row">
                <div className="relative flex-1"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca platos, restaurantes o categorias" className="h-12 w-full rounded-xl border border-slate-200 pl-12 pr-4 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" /></div>
                <a href="#platos" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 font-semibold text-white hover:bg-orange-600">Buscar <ArrowRight className="h-4 w-4" /></a>
              </div>
              <div className="mt-6 flex flex-wrap gap-5 text-sm text-slate-500"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-orange-500" /> {restaurants.length} restaurantes</span><span className="flex items-center gap-2"><UtensilsCrossed className="h-4 w-4 text-orange-500" /> {menuItems.length} platos disponibles</span></div>
            </div>
            <div className="hidden rounded-[2rem] bg-slate-900 p-8 text-white shadow-2xl lg:block">
              <div className="flex items-center justify-between"><div><p className="text-sm text-orange-300">Pedido rapido</p><h2 className="mt-1 text-2xl font-bold">Elegir. Pedir. Disfrutar.</h2></div><ShoppingBag className="h-10 w-10 text-orange-400" /></div>
              <div className="mt-8 space-y-4">{['Busca lo que queres comer', 'Agrega platos de un restaurante', 'Ingresa y confirma tu entrega'].map((step, index) => <div key={step} className="flex items-center gap-4 rounded-2xl bg-white/10 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 font-bold">{index + 1}</span><span>{step}</span></div>)}</div>
            </div>
          </div>
        </section>

        <section id="restaurantes" className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="mb-7 flex items-end justify-between"><div><p className="font-semibold text-orange-600">Cerca tuyo</p><h2 className="mt-1 text-3xl font-bold">Restaurantes destacados</h2></div></div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredRestaurants.slice(0, 6).map((restaurant) => <article key={restaurant.id} className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"><button type="button" onClick={() => openRestaurant(restaurant)} className="block w-full text-left"><div className="h-36 bg-gradient-to-br from-orange-100 to-amber-50">{restaurant.image_url ? <img src={restaurant.image_url} alt={restaurant.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><Store className="h-12 w-12 text-orange-300" /></div>}</div><div className="p-5"><h3 className="text-lg font-bold">{restaurant.name}</h3><p className="mt-1 line-clamp-2 text-sm text-slate-500">{restaurant.description || 'Conoce todos los platos disponibles.'}</p><div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500"><span className="flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{restaurant.address || 'Retiro y delivery'}</span></span><span className="shrink-0 rounded-full bg-green-50 px-2 py-1 font-semibold text-green-700">Ver menu</span></div></div></button></article>)}
          </div>
        </section>

        <section id="platos" className="bg-white py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-7 flex items-end justify-between gap-4"><div><p className="font-semibold text-orange-600">Explora el menu</p><h2 className="mt-1 text-3xl font-bold">Platos para todos los gustos</h2></div><div className="hidden gap-2 sm:flex"><button type="button" onClick={() => scrollCategories(-1)} aria-label="Categorias anteriores" className="rounded-full border border-slate-200 p-2.5 text-slate-600 hover:border-orange-300 hover:text-orange-600"><ArrowLeft className="h-5 w-5" /></button><button type="button" onClick={() => scrollCategories(1)} aria-label="Categorias siguientes" className="rounded-full border border-slate-200 p-2.5 text-slate-600 hover:border-orange-300 hover:text-orange-600"><ArrowRight className="h-5 w-5" /></button></div></div>
            <div ref={categoryCarouselRef} className="mb-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button onClick={() => setCategoryId('all')} className={`relative h-52 w-64 shrink-0 snap-start overflow-hidden rounded-2xl text-left transition ${categoryId === 'all' ? 'ring-4 ring-orange-400' : 'hover:-translate-y-1 hover:shadow-lg'}`}><div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-amber-600" /><div className="absolute inset-0 bg-black/15" /><div className="absolute inset-x-0 bottom-0 p-5 text-white"><h3 className="text-xl font-bold">Todas las categorias</h3><p className="mt-1 text-sm text-white/85">Mira todos los platos disponibles.</p></div></button>
              {dishCategories.map((category) => <button key={category.id} onClick={() => setCategoryId(category.id)} className={`group relative h-52 w-64 shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-800 text-left transition ${categoryId === category.id ? 'ring-4 ring-orange-400' : 'hover:-translate-y-1 hover:shadow-lg'}`}>{category.image_url ? <img src={category.image_url} alt={category.name} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />}<div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" /><div className="absolute inset-x-0 bottom-0 p-5 text-white"><h3 className="text-xl font-bold">{category.name}</h3>{category.description && <p className="mt-1 line-clamp-2 text-sm text-white/85">{category.description}</p>}</div></button>)}
            </div>
            {loading ? <div className="py-16 text-center text-slate-500">Cargando catalogo...</div> : filteredItems.length === 0 ? <div className="rounded-2xl bg-slate-50 py-16 text-center"><Search className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 text-slate-500">No encontramos resultados para tu busqueda.</p></div> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filteredItems.slice(0, 12).map((item) => { const restaurant = restaurantById.get(item.restaurant_id); return <article key={item.id} className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-lg"><div className="h-40 overflow-hidden bg-slate-100">{item.image_url ? <img src={item.image_url} alt={item.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center"><UtensilsCrossed className="h-10 w-10 text-slate-300" /></div>}</div><div className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{restaurant?.name}</p><h3 className="mt-1 font-bold">{item.name}</h3><p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{item.description || item.category}</p><div className="mt-4 flex items-center justify-between"><span className="text-xl font-black">${Number(item.price).toLocaleString('es-AR')}</span><button onClick={() => addToCart(item)} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">Agregar</button></div></div></article>; })}</div>}
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><div className="grid gap-5 md:grid-cols-3">{[[Search, 'Busca y elegi', 'Filtra por restaurante, plato o categoria.'], [ShoppingBag, 'Arma tu pedido', 'Agrega productos al carrito y revisa el total.'], [Clock3, 'Recibi o retira', 'Inicia sesion, confirma los datos y hace el pedido.']].map(([Icon, title, description]) => { const StepIcon = Icon as typeof Search; return <div key={title as string} className="rounded-2xl bg-white p-6 shadow-sm"><StepIcon className="h-8 w-8 text-orange-500" /><h3 className="mt-4 text-lg font-bold">{title as string}</h3><p className="mt-2 text-slate-500">{description as string}</p></div>; })}</div></section>
        </>
        )}
      </main>

      <footer className="bg-slate-900 px-4 py-10 text-center text-sm text-slate-400"><p className="font-semibold text-white">Food Delivery</p><p className="mt-2">Restaurantes y platos en un solo lugar.</p></footer>

      {showCart && <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50" onClick={() => setShowCart(false)}><aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-bold">Tu carrito</h2><p className="text-sm text-slate-500">{cartRestaurant?.name || 'Todavia no agregaste platos'}</p></div><div className="flex items-center gap-1">{cart.length > 0 && <button onClick={clearCart} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">Vaciar</button>}<button onClick={() => setShowCart(false)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div></div><div className="flex-1 space-y-3 overflow-y-auto p-5">{cart.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border p-3"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.name}</p><p className="text-sm text-orange-600">${Number(item.price).toLocaleString('es-AR')}</p></div><div className="flex items-center gap-2"><button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="h-8 w-8 rounded-lg bg-slate-100">-</button><span className="w-5 text-center">{item.quantity}</span><button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="h-8 w-8 rounded-lg bg-slate-100">+</button><button onClick={() => updateQuantity(item.id, 0)} className="ml-1 rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Eliminar ${item.name}`} title="Eliminar"><Trash2 className="h-4 w-4" /></button></div></div>)}{cart.length === 0 && <div className="py-16 text-center text-slate-400"><ShoppingBag className="mx-auto h-12 w-12" /><p className="mt-3">Tu carrito esta vacio</p></div>}{user && cart.length > 0 && <div className="space-y-3 rounded-xl bg-slate-50 p-4"><div className="grid grid-cols-2 gap-2"><button onClick={() => setDeliveryMethod('delivery')} className={`rounded-lg border p-2 text-sm font-semibold ${deliveryMethod === 'delivery' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>Delivery</button><button onClick={() => setDeliveryMethod('pickup')} className={`rounded-lg border p-2 text-sm font-semibold ${deliveryMethod === 'pickup' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>Retiro</button></div>{deliveryMethod === 'delivery' && <div className="space-y-2"><textarea value={deliveryAddress} onChange={(event) => updateDeliveryAddress(event.target.value)} rows={3} placeholder="Direccion de entrega" className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-orange-500" /><button type="button" onClick={() => void geolocateDeliveryAddress()} disabled={geoLoading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"><MapPin className="h-4 w-4" />{geoLoading ? 'Ubicando...' : 'Geolocalizar'}</button>{deliveryLocation && <p className="text-xs font-medium text-emerald-600">Ubicacion GPS detectada.</p>}{geoError && <p className="text-xs text-red-600">{geoError}</p>}</div>}{message && <p className="text-sm text-red-600">{message}</p>}</div>}</div><div className="border-t p-5"><div className="mb-4 flex justify-between text-lg font-bold"><span>Total</span><span>${cartTotal.toLocaleString('es-AR')}</span></div>{user ? <button disabled={!cart.length || submittingOrder} onClick={handleCheckout} className="w-full rounded-xl bg-orange-500 py-3 font-bold text-white hover:bg-orange-600 disabled:opacity-40">{submittingOrder ? 'Confirmando...' : 'Confirmar pedido'}</button> : <button disabled={!cart.length} onClick={() => setShowAuth(true)} className="w-full rounded-xl bg-orange-500 py-3 font-bold text-white hover:bg-orange-600 disabled:opacity-40">Ingresar para hacer el pedido</button>}</div></aside></div>}
      {showAuth && <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/60 p-4"><div className="flex min-h-full items-center justify-center"><div className="relative w-full max-w-md"><button onClick={() => setShowAuth(false)} className="absolute right-3 top-3 z-10 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X className="h-5 w-5" /></button><Auth embedded /></div></div></div>}
    </div>
  );
}

interface RestaurantViewProps {
  restaurant: Restaurant;
  items: MenuItem[];
  onBack: () => void;
  onAddToCart: (item: MenuItem) => void;
}

function RestaurantView({ restaurant, items, onBack, onAddToCart }: RestaurantViewProps) {
  return (
    <section className="mx-auto min-h-[70vh] max-w-7xl px-4 py-10 sm:px-6">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-orange-600">
        <ArrowLeft className="h-4 w-4" /> Volver a restaurantes
      </button>

      <div className="overflow-hidden rounded-3xl bg-slate-900 text-white shadow-xl">
        <div className="grid md:grid-cols-[.8fr_1.2fr]">
          <div className="h-56 bg-gradient-to-br from-orange-100 to-amber-50 md:h-72">
            {restaurant.image_url ? (
              <img src={restaurant.image_url} alt={restaurant.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center"><Store className="h-16 w-16 text-orange-300" /></div>
            )}
          </div>
          <div className="flex flex-col justify-center p-7 sm:p-10">
            <p className="text-sm font-semibold uppercase tracking-wide text-orange-300">Menu completo</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">{restaurant.name}</h1>
            <p className="mt-4 max-w-2xl text-slate-300">{restaurant.description || 'Conoce todos los platos disponibles.'}</p>
            <div className="mt-5 flex items-center gap-2 text-sm text-slate-300">
              <MapPin className="h-4 w-4 shrink-0 text-orange-400" /> {restaurant.address || 'Retiro y delivery'}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-7 mt-10">
        <p className="font-semibold text-orange-600">Todos los platos</p>
        <h2 className="mt-1 text-3xl font-bold">Que ofrece {restaurant.name}</h2>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
          <UtensilsCrossed className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-slate-500">Este restaurante todavia no tiene platos disponibles.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <article key={item.id} className="group overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-lg">
              <div className="h-40 overflow-hidden bg-slate-100">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full items-center justify-center"><UtensilsCrossed className="h-10 w-10 text-slate-300" /></div>
                )}
              </div>
              <div className="p-4">
                {item.category && <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">{item.category}</p>}
                <h3 className="mt-1 font-bold">{item.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-500">{item.description || item.category}</p>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xl font-black">${Number(item.price).toLocaleString('es-AR')}</span>
                  <button onClick={() => onAddToCart(item)} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600">Agregar</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const orderStatusLabels: Record<Order['status'], string> = {
  ...customerOrderStatusLabels,
};

interface CartViewProps {
  cart: CartItem[];
  restaurant: Restaurant | null;
  total: number;
  deliveryMethod: 'delivery' | 'pickup';
  deliveryAddress: string;
  message: string;
  submitting: boolean;
  onBack: () => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onClear: () => void;
  onDeliveryMethodChange: (method: 'delivery' | 'pickup') => void;
  onDeliveryAddressChange: (address: string) => void;
  onGeolocate: () => void;
  geoLoading: boolean;
  geoError: string | null;
  hasGeolocation: boolean;
  onCheckout: () => Promise<void>;
}

function CartView({ cart, restaurant, total, deliveryMethod, deliveryAddress, message, submitting, onBack, onUpdateQuantity, onClear, onDeliveryMethodChange, onDeliveryAddressChange, onGeolocate, geoLoading, geoError, hasGeolocation, onCheckout }: CartViewProps) {
  return (
    <section className="mx-auto min-h-[70vh] max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-orange-600">Mi perfil</p>
          <h1 className="text-3xl font-bold">Mi carrito</h1>
          <p className="mt-1 text-slate-500">{restaurant?.name || 'Todavia no agregaste platos'}</p>
        </div>
        <div className="flex gap-2">
          {cart.length > 0 && <button onClick={onClear} className="rounded-xl border border-red-200 px-4 py-2 font-semibold text-red-600 hover:bg-red-50"><Trash2 className="mr-2 inline h-4 w-4" />Vaciar carrito</button>}
          <button onClick={onBack} className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-white">Seguir comprando</button>
        </div>
      </div>

      {cart.length === 0 ? (
        <div className="rounded-2xl bg-white py-20 text-center text-slate-400 shadow-sm"><ShoppingBag className="mx-auto h-14 w-14" /><p className="mt-3">Tu carrito esta vacio</p></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            {cart.map((item) => (
              <article key={item.id} className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
                <div className="min-w-0 flex-1"><p className="font-bold">{item.name}</p><p className="text-sm text-orange-600">${Number(item.price).toLocaleString('es-AR')}</p></div>
                <div className="flex items-center gap-2"><button onClick={() => onUpdateQuantity(item.id, item.quantity - 1)} className="h-9 w-9 rounded-lg bg-slate-100">-</button><span className="w-6 text-center font-semibold">{item.quantity}</span><button onClick={() => onUpdateQuantity(item.id, item.quantity + 1)} className="h-9 w-9 rounded-lg bg-slate-100">+</button></div>
                <button onClick={() => onUpdateQuantity(item.id, 0)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label={`Eliminar ${item.name}`}><Trash2 className="h-5 w-5" /></button>
              </article>
            ))}
          </div>
          <aside className="h-fit rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Resumen</h2>
            <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onDeliveryMethodChange('delivery')} className={`rounded-lg border p-2 text-sm font-semibold ${deliveryMethod === 'delivery' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>Delivery</button><button onClick={() => onDeliveryMethodChange('pickup')} className={`rounded-lg border p-2 text-sm font-semibold ${deliveryMethod === 'pickup' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200'}`}>Retiro</button></div>
            {deliveryMethod === 'delivery' && <div className="mt-3 space-y-2">
              <textarea value={deliveryAddress} onChange={(event) => onDeliveryAddressChange(event.target.value)} rows={3} placeholder="Direccion de entrega" className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-orange-500" />
              <button type="button" onClick={onGeolocate} disabled={geoLoading} className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"><MapPin className="h-4 w-4" />{geoLoading ? 'Ubicando...' : 'Geolocalizar'}</button>
              {hasGeolocation && <p className="text-xs font-medium text-emerald-600">Ubicacion GPS detectada.</p>}
              {geoError && <p className="text-xs text-red-600">{geoError}</p>}
            </div>}
            {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
            <div className="my-5 flex justify-between border-t pt-4 text-lg font-bold"><span>Total</span><span>${total.toLocaleString('es-AR')}</span></div>
            <button disabled={submitting} onClick={() => void onCheckout()} className="w-full rounded-xl bg-orange-500 py-3 font-bold text-white hover:bg-orange-600 disabled:opacity-50">{submitting ? 'Confirmando...' : 'Confirmar pedido'}</button>
          </aside>
        </div>
      )}
    </section>
  );
}

function OrdersView({ orders, onBack }: { orders: Order[]; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | Order['status']>('all');
  const [deliveryMethodFilter, setDeliveryMethodFilter] = useState<'all' | 'delivery' | 'pickup'>('all');

  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return orders.filter((order) => {
      const matchesSearch = !normalizedSearch || [order.id, order.delivery_address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
      const matchesStatus = status === 'all' || order.status === status;
      const matchesDeliveryMethod = deliveryMethodFilter === 'all' || order.delivery_method === deliveryMethodFilter;

      return matchesSearch && matchesStatus && matchesDeliveryMethod;
    });
  }, [deliveryMethodFilter, orders, search, status]);

  const hasActiveFilters = search.trim() || status !== 'all' || deliveryMethodFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setStatus('all');
    setDeliveryMethodFilter('all');
  }

  return (
    <section className="mx-auto min-h-[70vh] max-w-4xl px-4 py-10 sm:px-6">
      <div className="rounded-2xl bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="text-xl font-bold">Mis pedidos</h2>
            <p className="text-sm text-slate-500">Historial y estado de tus compras</p>
          </div>
          <button onClick={onBack} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Volver</button>
        </div>
        <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-3">
          <label className="relative sm:col-span-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por numero o direccion"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="text-sm font-medium text-slate-600">
            Estado
            <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | Order['status'])} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 outline-none focus:border-orange-400">
              <option value="all">Todos</option>
              {Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-600">
            Entrega
            <select value={deliveryMethodFilter} onChange={(event) => setDeliveryMethodFilter(event.target.value as 'all' | 'delivery' | 'pickup')} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 outline-none focus:border-orange-400">
              <option value="all">Todas</option>
              <option value="delivery">Delivery</option>
              <option value="pickup">Retiro</option>
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
              <Filter className="h-4 w-4" /> Limpiar filtros
            </button>
          </div>
        </div>
        <div className="space-y-3 p-5">
          {orders.length === 0 ? (
            <div className="py-14 text-center text-slate-400">
              <Clock3 className="mx-auto h-12 w-12" />
              <p className="mt-3">Todavia no realizaste pedidos.</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-14 text-center text-slate-400">
              <Search className="mx-auto h-12 w-12" />
              <p className="mt-3">No hay pedidos que coincidan con los filtros.</p>
              <button type="button" onClick={clearFilters} className="mt-4 text-sm font-semibold text-orange-600 hover:text-orange-700">Ver todos los pedidos</button>
            </div>
          ) : filteredOrders.map((order) => (
            <article key={order.id} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">Pedido #{order.id.slice(0, 8)}</p>
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">
                    {orderStatusLabels[order.status]}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {new Date(order.created_at).toLocaleString('es-AR')} · {order.delivery_method === 'pickup' ? 'Retiro' : 'Delivery'}
                </p>
                <p className="mt-1 text-sm text-slate-600">{order.delivery_address}</p>
              </div>
              <p className="text-xl font-black text-orange-600">${Number(order.total_amount).toLocaleString('es-AR')}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProfileView({ profile, onSaved, onBack }: { profile: Profile; onSaved: () => Promise<void>; onBack: () => void }) {
  const [fullName, setFullName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [address, setAddress] = useState(profile.delivery_address || '');
  const [notificationPermission, setNotificationPermission] = useState<OrderNotificationPermissionState>(() => getOrderNotificationPermissionState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  async function handleNotificationPermission() {
    const permission = await requestOrderNotificationPermission();
    setNotificationPermission(permission);
  }

  const notificationStatus = {
    granted: {
      label: 'Activadas',
      description: 'Vas a recibir avisos cuando cambie el estado de tus pedidos.',
      className: 'bg-emerald-50 text-emerald-700',
      button: 'Notificaciones activadas',
      disabled: true,
    },
    default: {
      label: 'Pendientes',
      description: 'Activalas para recibir avisos del estado de tus pedidos en este dispositivo.',
      className: 'bg-orange-50 text-orange-700',
      button: 'Activar notificaciones',
      disabled: false,
    },
    denied: {
      label: 'Bloqueadas',
      description: 'El navegador las tiene bloqueadas. Habilitalas desde los permisos del sitio.',
      className: 'bg-red-50 text-red-700',
      button: 'Permiso bloqueado',
      disabled: true,
    },
    unsupported: {
      label: 'No disponibles',
      description: 'Este navegador no permite Push Web o falta configurar las claves de notificaciones.',
      className: 'bg-slate-100 text-slate-600',
      button: 'No disponible',
      disabled: true,
    },
  } satisfies Record<OrderNotificationPermissionState, { label: string; description: string; className: string; button: string; disabled: boolean }>;

  const currentNotificationStatus = notificationStatus[notificationPermission];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        delivery_address: address.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    if (updateError) {
      setError('No se pudo actualizar el perfil.');
      setSaving(false);
      return;
    }

    await onSaved();
    setSaved(true);
    setSaving(false);
  }

  async function handlePasswordChange(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError('');
    setPasswordChanged(false);

    if (newPassword.length < 6) {
      setPasswordError('La nueva contrasena debe tener al menos 6 caracteres.');
      return;
    }

    if (newPassword !== passwordConfirmation) {
      setPasswordError('Las contrasenas no coinciden.');
      return;
    }

    setChangingPassword(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setPasswordError(updateError.message || 'No se pudo cambiar la contrasena.');
      setChangingPassword(false);
      return;
    }

    setNewPassword('');
    setPasswordConfirmation('');
    setPasswordChanged(true);
    setChangingPassword(false);
  }

  return (
    <section className="mx-auto min-h-[70vh] max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">Mi perfil</h2>
          <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Volver</button>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">Nombre completo<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 outline-none focus:border-orange-500" /></label>
          <label className="block text-sm font-medium text-slate-700">Telefono<input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 outline-none focus:border-orange-500" /></label>
          <label className="block text-sm font-medium text-slate-700">Direccion de entrega<textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3 outline-none focus:border-orange-500" /></label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-600">Perfil actualizado correctamente.</p>}
          <button disabled={saving} className="w-full rounded-xl bg-orange-500 py-3 font-bold text-white hover:bg-orange-600 disabled:opacity-50">{saving ? 'Guardando...' : 'Guardar cambios'}</button>
        </div>
      </form>
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><BellRing className="h-5 w-5" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">Notificaciones de pedidos</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentNotificationStatus.className}`}>{currentNotificationStatus.label}</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">{currentNotificationStatus.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleNotificationPermission()}
            disabled={currentNotificationStatus.disabled}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {currentNotificationStatus.button}
          </button>
        </div>
      </div>
      <form onSubmit={handlePasswordChange} className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><KeyRound className="h-5 w-5" /></span>
          <div>
            <h2 className="text-xl font-bold">Cambiar contrasena</h2>
            <p className="text-sm text-slate-500">Usa al menos 6 caracteres.</p>
          </div>
        </div>
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">Nueva contrasena<input type="password" autoComplete="new-password" required minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 outline-none focus:border-orange-500" /></label>
          <label className="block text-sm font-medium text-slate-700">Confirmar nueva contrasena<input type="password" autoComplete="new-password" required minLength={6} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 outline-none focus:border-orange-500" /></label>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          {passwordChanged && <p className="text-sm text-green-600">Contrasena actualizada correctamente.</p>}
          <button disabled={changingPassword} className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50">{changingPassword ? 'Actualizando...' : 'Cambiar contrasena'}</button>
        </div>
      </form>
    </section>
  );
}
