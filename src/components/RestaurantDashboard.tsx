import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, Restaurant, MenuItem, Order } from '../lib/supabase';
import { useGeolocation } from '../hooks/useGeolocation';
import { addDefaultLocality } from '../lib/address';
import {
  LogOut,
  Plus,
  Store,
  UtensilsCrossed,
  Trash2,
  Clock,
  CreditCard as Edit2,
  Image as ImageIcon,
  MapPin,
  Phone,
  Navigation,
  PackageCheck,
  ChefHat,
  Bike,
  CheckCircle2,
  XCircle,
  Route,
  ArrowLeft,
  MessageCircle,
  Menu,
  X,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';

type RestaurantOrder = Order & {
  customer?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
  order_items?: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    menu_item?: {
      name: string | null;
      category: string | null;
    } | null;
  }>;
};

type OrderGroupId = 'pending' | 'kitchen' | 'delivery' | 'closed';

type RestaurantDriver = {
  driver_id: string;
  is_active: boolean;
  driver: { id: string; full_name: string; email: string; phone: string | null };
};

type RouteHistory = {
  id: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  driver: { full_name: string; phone: string | null };
  delivery_route_orders: Array<{
    id: string;
    stop_sequence: number;
    status: 'pending' | 'delivered' | 'failed';
    delivered_at: string | null;
    delivery_notes: string | null;
    order: RestaurantOrder;
  }>;
};

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

export function RestaurantDashboard() {
  const { profile, signOut } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'menu' | 'orders' | 'route' | 'drivers'>('orders');
  const [activeOrderGroupId, setActiveOrderGroupId] = useState<OrderGroupId>('pending');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [routeOrderIds, setRouteOrderIds] = useState<string[]>([]);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [drivers, setDrivers] = useState<RestaurantDriver[]>([]);
  const [routes, setRoutes] = useState<RouteHistory[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [dispatchingRoute, setDispatchingRoute] = useState(false);

  useEffect(() => {
    if (profile) {
      loadRestaurants();
    }
  }, [profile]);

  useEffect(() => {
    if (selectedRestaurant) {
      loadMenuItems();
      loadOrders();
      loadDrivers();
      loadRoutes();
    }
  }, [selectedRestaurant]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    const channel = supabase
      .channel(`restaurant-routes-${selectedRestaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_routes', filter: `restaurant_id=eq.${selectedRestaurant.id}` }, () => void loadRoutes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_route_orders' }, () => { void loadRoutes(); void loadOrders(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedRestaurant]);

  async function loadRestaurants() {
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .eq('owner_id', profile!.id)
      .order('created_at', { ascending: false });

    if (data) {
      setRestaurants(data);
      if (data.length > 0 && !selectedRestaurant) {
        setSelectedRestaurant(data[0]);
      }
    }
  }

  async function loadMenuItems() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.id)
      .order('category', { ascending: true });

    if (data) setMenuItems(data);
  }

  async function loadOrders() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        customer:profiles!orders_customer_id_fkey (full_name, email, phone),
        order_items (
          id,
          quantity,
          unit_price,
          subtotal,
          menu_item:menu_items (name, category)
        )
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at', { ascending: false });

    if (data) {
      const loadedOrders = data as RestaurantOrder[];
      setOrders(loadedOrders);
      setSelectedOrderId((currentId) => {
        if (currentId && loadedOrders.some((order) => order.id === currentId)) return currentId;
        setShowOrderDetail(false);
        return null;
      });
      setRouteOrderIds((currentIds) =>
        currentIds.filter((id) =>
          loadedOrders.some((order) => order.id === id && canAddToRoute(order))
        )
      );
    }
  }

  async function loadDrivers() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('restaurant_drivers')
      .select('driver_id, is_active, driver:profiles!restaurant_drivers_driver_id_fkey (id, full_name, email, phone)')
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at');
    const loadedDrivers = (data || []) as unknown as RestaurantDriver[];
    setDrivers(loadedDrivers);
    setSelectedDriverId((current) => loadedDrivers.some((item) => item.driver_id === current && item.is_active) ? current : loadedDrivers.find((item) => item.is_active)?.driver_id || '');
  }

  async function loadRoutes() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('delivery_routes')
      .select(`
        id, status, assigned_at, started_at, completed_at,
        driver:profiles!delivery_routes_driver_id_fkey (full_name, phone),
        delivery_route_orders (
          id, stop_sequence, status, delivered_at, delivery_notes,
          order:orders!delivery_route_orders_order_id_fkey (*, customer:profiles!orders_customer_id_fkey (full_name, email, phone))
        )
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setRoutes(data as unknown as RouteHistory[]);
  }

  async function handleUpdateOrderStatus(orderId: string, status: Order['status']) {
    await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    loadOrders();
  }

  function toggleRouteOrder(orderId: string) {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);
    if (!order || !canAddToRoute(order)) return;

    setRouteOrderIds((currentIds) =>
      currentIds.includes(orderId)
        ? currentIds.filter((id) => id !== orderId)
        : [...currentIds, orderId]
    );
  }

  function handleOpenOrderDetail(orderId: string) {
    setSelectedOrderId(orderId);
    setShowOrderDetail(true);
  }

  async function handleDispatchRoute() {
    if (!selectedRestaurant || routeOrderIds.length === 0 || !selectedDriverId) return;
    setDispatchingRoute(true);
    setRouteError('');
    const { error } = await supabase.rpc('assign_delivery_route', {
      target_restaurant_id: selectedRestaurant.id,
      target_driver_id: selectedDriverId,
      target_order_ids: routeOrderIds,
    });
    if (error) setRouteError(error.message);
    else setRouteOrderIds([]);
    await Promise.all([loadOrders(), loadRoutes()]);
    setDispatchingRoute(false);
  }

  async function handleDeleteMenuItem(id: string) {
    await supabase.from('menu_items').delete().eq('id', id);
    loadMenuItems();
  }

  async function handleToggleAvailability(item: MenuItem) {
    await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id);
    loadMenuItems();
  }

  const statusColors: Record<Order['status'], string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    preparing: 'bg-orange-100 text-orange-800',
    delivering: 'bg-cyan-100 text-cyan-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  const statusLabels: Record<Order['status'], string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    preparing: 'Preparando',
    delivering: 'En camino',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  };

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null;
  const pendingRouteOrders = routeOrderIds
    .map((id) => orders.find((order) => order.id === id))
    .filter((order): order is RestaurantOrder => {
      if (!order) return false;
      return canAddToRoute(order);
    });
  const routeOrders = [
    ...orders.filter((order) => order.status === 'delivering' && !isPickupOrder(order)),
    ...pendingRouteOrders,
  ];
  const orderGroups: Array<{ id: OrderGroupId; title: string; icon: typeof Clock; orders: RestaurantOrder[] }> = [
    { id: 'pending', title: 'Nuevos', icon: Clock, orders: orders.filter((order) => order.status === 'pending') },
    { id: 'kitchen', title: 'Cocina', icon: ChefHat, orders: orders.filter((order) => order.status === 'confirmed' || order.status === 'preparing') },
    { id: 'delivery', title: 'Reparto', icon: Bike, orders: orders.filter((order) => order.status === 'delivering') },
    { id: 'closed', title: 'Cerrados', icon: CheckCircle2, orders: orders.filter((order) => order.status === 'delivered' || order.status === 'cancelled') },
  ];
  const activeOrderGroup = orderGroups.find((group) => group.id === activeOrderGroupId) || orderGroups[0];
  const ActiveOrderGroupIcon = activeOrderGroup.icon;
  const routeOrigin = selectedRestaurant?.address?.trim() || '';
  const routeMapUrl = routeOrders.length > 0 ? getRouteMapUrl() : '';
  const routeEmbedUrl = routeOrders.length > 0 ? getRouteEmbedUrl() : '';
  const routeWhatsAppUrl = routeOrders.length > 0 ? getRouteWhatsAppUrl() : '';

  function isPickupOrder(order: RestaurantOrder) {
    return order.delivery_method === 'pickup';
  }

  function canAddToRoute(order: RestaurantOrder) {
    return !isPickupOrder(order) && (order.status === 'confirmed' || order.status === 'preparing');
  }

  function getFulfillmentLabel(order: RestaurantOrder) {
    return isPickupOrder(order) ? 'Retira en restaurante' : 'Entrega a domicilio';
  }

  function getOrderAddressLabel(order: RestaurantOrder) {
    return isPickupOrder(order)
      ? `Retiro en restaurante${order.delivery_address ? ` - ${order.delivery_address}` : ''}`
      : order.delivery_address;
  }

  function getOrderLocationQuery(order: RestaurantOrder) {
    const address = order.delivery_address?.trim();
    if (address) return address;

    return order.latitude !== null && order.longitude !== null
      ? `${order.latitude},${order.longitude}`
      : '';
  }

  function getOrderMapUrl(order: RestaurantOrder) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(getOrderLocationQuery(order))}`;
  }

  function getOrderEmbedUrl(order: RestaurantOrder) {
    const query = getOrderLocationQuery(order);
    return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
  }

  function getRouteMapUrl() {
    const stops = routeOrders.map(getOrderLocationQuery);
    const destination = stops[stops.length - 1] || '';
    const waypoints = stops.slice(0, -1).join('|');

    const params = new URLSearchParams({
      api: '1',
      destination,
      travelmode: 'driving',
    });

    if (routeOrigin) params.set('origin', routeOrigin);
    if (waypoints) params.set('waypoints', waypoints);

    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  function getRouteEmbedUrl() {
    const stops = routeOrders.map(getOrderLocationQuery);

    if (!routeOrigin && stops.length === 1) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(stops[0])}&z=15&output=embed`;
    }

    const origin = routeOrigin || stops[0];
    const destinations = routeOrigin ? stops : stops.slice(1);
    const params = new URLSearchParams({
      output: 'embed',
      saddr: origin,
      daddr: destinations.join(' to:'),
    });

    return `https://maps.google.com/maps?${params.toString()}`;
  }

  function getRouteWhatsAppUrl() {
    const lines = [
      `Hoja de ruta - ${selectedRestaurant?.name || 'Restaurante'}`,
      routeOrigin ? `Origen: ${routeOrigin}` : 'Origen: no definido',
      '',
      'Paradas:',
      ...routeOrders.map((order, index) => {
        const phone = order.customer?.phone?.trim();
        const phoneText = phone ? ` - Tel: ${phone}` : '';
        return `${index + 1}. ${getCustomerName(order)} - ${getOrderAddressLabel(order)}${phoneText}`;
      }),
      '',
      `Recorrido: ${routeMapUrl}`,
    ];

    return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function getNextStatus(order: RestaurantOrder): Order['status'] | null {
    if (order.status === 'pending') return 'confirmed';
    if (order.status === 'confirmed') return 'preparing';
    if (isPickupOrder(order) && order.status === 'preparing') return 'delivered';
    if (order.status === 'preparing') return 'delivering';
    if (order.status === 'delivering') return 'delivered';
    return null;
  }

  function getNextStatusLabel(order: RestaurantOrder) {
    if (order.status === 'pending') return 'Confirmar';
    if (order.status === 'confirmed') return 'Preparar';
    if (isPickupOrder(order) && order.status === 'preparing') return 'Entregar';
    if (order.status === 'preparing') return 'Enviar';
    if (order.status === 'delivering') return 'Entregar';
    return '';
  }

  function getCustomerName(order: RestaurantOrder) {
    const name = order.customer?.full_name?.trim();
    const email = order.customer?.email?.trim();
    const phone = order.customer?.phone?.trim();
    const guestName = order.guest_customer_name?.trim();
    return name || email || phone || guestName || (order.customer_id
      ? `Cliente #${order.customer_id.slice(0, 8)}`
      : 'Cliente sin registrar');
  }

  function renderOrderDetailScreen(order: RestaurantOrder) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => {
            setShowOrderDetail(false);
            setSelectedOrderId(null);
          }}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          {activeTab === 'route' ? 'Volver a la hoja de ruta' : 'Volver a pedidos'}
        </button>

        <section className="border border-gray-200 rounded-lg p-4">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Pedido seleccionado</p>
                <p className="text-sm text-gray-500">Pedido #{order.id.slice(0, 8)}</p>
                <h3 className="text-xl font-bold text-gray-800">{getCustomerName(order)}</h3>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.status]}`}>
                {statusLabels[order.status]}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500">Total</p>
                <p className="text-lg font-bold text-orange-600">{moneyFormatter.format(order.total_amount)}</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500">Fecha</p>
                <p className="text-sm font-semibold text-gray-800">
                  {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Detalle del pedido</h4>
              <div className="space-y-2">
                {order.order_items && order.order_items.length > 0 ? (
                  order.order_items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3 border-b border-gray-100 pb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{item.quantity}x {item.menu_item?.name || 'Producto'}</p>
                        {item.menu_item?.category && <p className="text-xs text-gray-500">{item.menu_item.category}</p>}
                      </div>
                      <p className="text-sm font-semibold text-gray-700">{moneyFormatter.format(item.subtotal)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No hay ítems cargados para este pedido.</p>
                )}
              </div>
            </div>

            {order.customer_notes && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-yellow-800 mb-1">Notas del cliente</p>
                <p className="text-sm text-yellow-900">{order.customer_notes}</p>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-gray-800 mb-2">{getFulfillmentLabel(order)}</h4>
              <div className="space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  {isPickupOrder(order) ? (
                    <Store className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                  )}
                  <span>{getOrderAddressLabel(order)}</span>
                </div>
                {order.customer?.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Phone className="w-4 h-4 text-gray-500" />
                    <span>{order.customer.phone}</span>
                  </div>
                )}
                <div className="rounded-lg overflow-hidden border border-gray-200 h-56">
                  <iframe title={`Ubicación del pedido ${order.id}`} src={getOrderEmbedUrl(order)} className="w-full h-full" loading="lazy" />
                </div>
                <a href={getOrderMapUrl(order)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                  <Navigation className="w-4 h-4" />
                  Abrir ubicación
                </a>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {getNextStatus(order) && (
                <button
                  type="button"
                  onClick={() => handleUpdateOrderStatus(order.id, getNextStatus(order)!)}
                  className="flex items-center gap-2 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition"
                >
                  <PackageCheck className="w-4 h-4" />
                  {getNextStatusLabel(order)}
                </button>
              )}
              {canAddToRoute(order) && (
                <button
                  type="button"
                  onClick={() => toggleRouteOrder(order.id)}
                  className="flex items-center gap-2 px-3 py-2 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 rounded-lg text-sm font-medium transition"
                >
                  <Route className="w-4 h-4" />
                  {routeOrderIds.includes(order.id) ? 'Quitar de ruta' : 'Sumar a ruta'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const restaurantNavItems = [
    { id: 'orders' as const, label: 'Pedidos', icon: PackageCheck },
    { id: 'route' as const, label: 'Hoja de ruta', icon: Route },
    { id: 'menu' as const, label: 'Menu', icon: UtensilsCrossed },
    { id: 'drivers' as const, label: 'Repartidores', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:flex">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500">
            <Store className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">Panel restaurante</p>
            <p className="truncate text-xs text-slate-500">{selectedRestaurant?.name || 'Sin restaurante'}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {restaurantNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate px-2 pb-2 text-xs text-slate-500">{profile?.full_name}</p>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4" />
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
                <p className="truncate text-sm font-semibold text-slate-900">Panel restaurante</p>
                <p className="truncate text-xs text-slate-500">{selectedRestaurant?.name || 'Sin restaurante'}</p>
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
            {restaurantNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="border-t border-slate-200 p-3">
            <p className="truncate px-2 pb-2 text-xs text-slate-500">{profile?.full_name}</p>
            <button
              onClick={() => {
                setIsMobileSidebarOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
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
              <span className="text-sm font-semibold">Panel restaurante</span>
            </div>
            <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="px-3 py-4 sm:px-5 lg:px-6 lg:py-5">
        {restaurants.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm">
            <Store className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <h2 className="mb-2 text-xl font-semibold text-gray-800">No tienes restaurantes</h2>
            <p className="text-gray-600 mb-6">Crea tu primer restaurante para empezar</p>
            <p className="text-gray-600 text-center">Contacta al administrador para crear un nuevo restaurante</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-gray-800">{selectedRestaurant?.name}</h1>
                <p className="text-sm text-gray-600">{selectedRestaurant?.address}</p>
              </div>
              {restaurants.length > 1 && (
                <select
                  value={selectedRestaurant?.id || ''}
                  onChange={(e) => {
                    const restaurant = restaurants.find(r => r.id === e.target.value);
                    if (restaurant) setSelectedRestaurant(restaurant);
                  }}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-orange-500"
                >
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-lg bg-white shadow-sm">
              <div className="hidden">
                <nav className="flex gap-4 px-6">
                  <button
                    onClick={() => setActiveTab('menu')}
                    className={`py-4 px-2 border-b-2 font-medium transition ${
                      activeTab === 'menu'
                        ? 'border-orange-500 text-orange-500'
                        : 'border-transparent text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Menú
                  </button>
                  <button
                    onClick={() => setActiveTab('orders')}
                    className={`py-4 px-2 border-b-2 font-medium transition ${
                      activeTab === 'orders'
                        ? 'border-orange-500 text-orange-500'
                        : 'border-transparent text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Pedidos
                  </button>
                </nav>
              </div>

              <div className="p-4 sm:p-5">
                {activeTab === 'menu' && (
                  <div>
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-bold text-gray-800">Elementos del Menú</h2>
                      <button
                        onClick={() => setShowMenuForm(true)}
                        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition"
                      >
                        <Plus className="w-5 h-5" />
                        Agregar Platillo
                      </button>
                    </div>

                    {menuItems.length === 0 ? (
                      <div className="text-center py-12">
                        <UtensilsCrossed className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600">No hay elementos en el menú</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {menuItems.map((item) => (
                          <div key={item.id} className="border rounded-lg overflow-hidden hover:shadow-md transition flex flex-col">
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.name} className="w-full h-40 object-cover" />
                            ) : (
                              <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
                                <ImageIcon className="w-8 h-8 text-gray-400" />
                              </div>
                            )}
                            <div className="p-4 flex-1 flex flex-col">
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-gray-800">{item.name}</h3>
                                  <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                                  {item.category && (
                                    <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded mt-2">
                                      {item.category}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-2 ml-2 flex-shrink-0">
                                  <button
                                    onClick={() => setEditingItem(item)}
                                    className="text-blue-500 hover:text-blue-700 p-1"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteMenuItem(item.id)}
                                    className="text-red-500 hover:text-red-700 p-1"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex justify-between items-center mt-auto pt-3 border-t">
                                <span className="text-lg font-bold text-orange-500">${item.price}</span>
                                <button
                                  onClick={() => handleToggleAvailability(item)}
                                  className={`text-xs px-2 py-1 rounded cursor-pointer transition ${
                                    item.is_available ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                                >
                                  {item.is_available ? 'Disponible' : 'No disponible'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'orders' && showOrderDetail && selectedOrder && renderOrderDetailScreen(selectedOrder)}

                {activeTab === 'orders' && !showOrderDetail && (
                  <div>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                      <div>
                        <h2 className="text-xl font-bold text-gray-800">Pedidos recibidos</h2>
                        <p className="text-sm text-gray-600">Gestiona cocina, entrega y reparto desde una sola vista.</p>
                      </div>
                      <div className="flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={() => setShowOrderForm(true)}
                          className="self-start rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 lg:self-end"
                        >
                          <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Nuevo pedido</span>
                        </button>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {orderGroups.map((group) => {
                          const Icon = group.icon;
                          const isActive = activeOrderGroupId === group.id;
                          return (
                            <button
                              key={group.id}
                              type="button"
                              onClick={() => setActiveOrderGroupId(group.id)}
                              className={`text-left border rounded-lg px-3 py-2 min-w-[110px] transition ${
                                isActive
                                  ? 'border-orange-500 bg-orange-50 shadow-sm'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <div className={`flex items-center gap-2 text-xs font-medium ${isActive ? 'text-orange-700' : 'text-gray-500'}`}>
                                <Icon className="w-4 h-4" />
                                {group.title}
                              </div>
                              <p className="text-2xl font-bold text-gray-800">{group.orders.length}</p>
                            </button>
                          );
                        })}
                      </div>
                      </div>
                    </div>

                    {orders.length === 0 ? (
                      <div className="text-center py-12">
                        <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600">No hay pedidos aún</p>
                      </div>
                    ) : (
                      <>
                      <div className="space-y-6">
                        <div className="space-y-6">
                          <section className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b">
                              <div className="flex items-center gap-2">
                                <ActiveOrderGroupIcon className="w-4 h-4 text-gray-500" />
                                <h3 className="font-semibold text-gray-800">{activeOrderGroup.title}</h3>
                              </div>
                              <span className="text-xs font-semibold text-gray-500">{activeOrderGroup.orders.length}</span>
                            </div>
                            {activeOrderGroup.orders.length === 0 ? (
                              <p className="text-sm text-gray-500 py-6 text-center">Sin pedidos</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full table-fixed text-xs">
                                  <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                                    <tr>
                                      <th className="w-[9%] px-2 py-2 text-left font-semibold">Pedido</th>
                                      <th className="w-[13%] px-2 py-2 text-left font-semibold">Cliente</th>
                                      <th className="w-[12%] px-2 py-2 text-left font-semibold">Fecha</th>
                                      <th className="w-[17%] px-2 py-2 text-left font-semibold">Entrega</th>
                                      <th className="w-[8%] px-2 py-2 text-right font-semibold">Total</th>
                                      <th className="w-[5%] px-2 py-2 text-center font-semibold">Items</th>
                                      <th className="w-[10%] px-2 py-2 text-left font-semibold">Estado</th>
                                      <th className="w-[26%] px-2 py-2 text-right font-semibold">Acciones</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {activeOrderGroup.orders.map((order) => {
                                      const nextStatus = getNextStatus(order);
                                      const isSelected = selectedOrder?.id === order.id;
                                      const isInRoute = routeOrderIds.includes(order.id);
                                      return (
                                        <tr key={order.id} className={`transition ${isSelected ? 'bg-orange-50' : 'bg-white hover:bg-gray-50'}`}>
                                          <td className="whitespace-nowrap px-2 py-2 align-middle">
                                            <button
                                              type="button"
                                              onClick={() => handleOpenOrderDetail(order.id)}
                                              className="font-semibold text-orange-600 hover:text-orange-700"
                                            >
                                              #{order.id.slice(0, 8)}
                                            </button>
                                          </td>
                                          <td className="min-w-0 px-2 py-2 align-middle">
                                            <p className="truncate font-medium text-gray-800" title={getCustomerName(order)}>{getCustomerName(order)}</p>
                                            {order.customer?.phone && <p className="truncate text-[11px] text-gray-500">{order.customer.phone}</p>}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 align-middle text-gray-700">
                                            {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                          </td>
                                          <td className="min-w-0 px-2 py-2 align-middle text-gray-600">
                                            <div className="flex items-center gap-1.5">
                                              {isPickupOrder(order) ? (
                                                <Store className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                                              ) : (
                                                <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                                              )}
                                              <span className="truncate" title={getOrderAddressLabel(order)}>{getOrderAddressLabel(order)}</span>
                                            </div>
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 text-right align-middle font-semibold text-orange-600">
                                            {moneyFormatter.format(order.total_amount)}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 text-center align-middle font-medium text-gray-700">
                                            {order.order_items?.length || 0}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 align-middle">
                                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
                                              {statusLabels[order.status]}
                                            </span>
                                          </td>
                                          <td className="px-2 py-2 align-middle">
                                            <div className="flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
                                              <button
                                                type="button"
                                                onClick={() => handleOpenOrderDetail(order.id)}
                                                className="inline-flex items-center justify-center rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
                                              >
                                                Detalle
                                              </button>
                                              {nextStatus && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleUpdateOrderStatus(order.id, nextStatus)}
                                                  className="inline-flex items-center justify-center gap-1 rounded-md bg-orange-500 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-orange-600"
                                                >
                                                  <PackageCheck className="h-3.5 w-3.5" />
                                                  {getNextStatusLabel(order)}
                                                </button>
                                              )}
                                              {canAddToRoute(order) && (
                                                <button
                                                  type="button"
                                                  onClick={() => toggleRouteOrder(order.id)}
                                                  className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                                                    isInRoute ? 'bg-cyan-100 text-cyan-800 hover:bg-cyan-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                  }`}
                                                >
                                                  <Route className="h-3.5 w-3.5" />
                                                  {isInRoute ? 'En ruta' : 'Ruta'}
                                                </button>
                                              )}
                                              {order.status !== 'delivered' && order.status !== 'cancelled' && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleUpdateOrderStatus(order.id, 'cancelled')}
                                                  className="inline-flex items-center justify-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 transition hover:bg-red-100"
                                                >
                                                  <XCircle className="h-3.5 w-3.5" />
                                                  Cancelar
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </section>

                          <section className="hidden">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                              <div>
                                <h3 className="font-bold text-gray-800">Hoja de ruta</h3>
                                <p className="text-sm text-gray-600">Muestra los pedidos seleccionados y los que siguen en camino.</p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {routeOrders.length > 0 && (
                                  <a href={routeMapUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                                    <Navigation className="w-4 h-4" />
                                    Ver recorrido
                                  </a>
                                )}
                                {routeOrders.length > 0 ? (
                                  <a href={routeWhatsAppUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition">
                                    <MessageCircle className="w-4 h-4" />
                                    Enviar por WhatsApp
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium opacity-50"
                                  >
                                    <MessageCircle className="w-4 h-4" />
                                    Enviar por WhatsApp
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={handleDispatchRoute}
                                  disabled={pendingRouteOrders.length === 0}
                                  className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition"
                                >
                                  <Bike className="w-4 h-4" />
                                  Marcar en reparto
                                </button>
                              </div>
                            </div>
                            {routeOrders.length > 0 && (
                              <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                                routeOrigin
                                  ? 'border-cyan-100 bg-cyan-50 text-cyan-900'
                                  : 'border-yellow-200 bg-yellow-50 text-yellow-900'
                              }`}>
                                {routeOrigin
                                  ? `Origen: ${routeOrigin}`
                                  : 'Falta la direccion del restaurante. Google Maps abrira la ruta hacia el destino, sin fijar el local como origen.'}
                              </div>
                            )}
                            {routeOrders.length === 0 ? (
                              <div className="border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center text-sm text-gray-500">
                                Selecciona pedidos confirmados o en preparación para armar el reparto. Permanecerán aquí mientras estén en camino.
                              </div>
                            ) : (
                              <ol className="space-y-2">
                                {routeOrders.map((order, index) => (
                                  <li key={order.id} className="flex items-start gap-3 border border-gray-200 rounded-lg p-3">
                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-cyan-100 text-cyan-800 text-sm font-bold flex-shrink-0">{index + 1}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold text-gray-800">#{order.id.slice(0, 8)} · {getCustomerName(order)}</p>
                                      <p className="text-sm text-gray-600">{getOrderAddressLabel(order)}</p>
                                    </div>
                                    {canAddToRoute(order) ? (
                                      <button type="button" onClick={() => toggleRouteOrder(order.id)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                                        Quitar
                                      </button>
                                    ) : (
                                      <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-medium text-cyan-800">En camino</span>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </section>
                        </div>

                      </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'route' && showOrderDetail && selectedOrder && renderOrderDetailScreen(selectedOrder)}

                {activeTab === 'route' && !showOrderDetail && (
                  <section className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-800">Hoja de ruta</h2>
                        <p className="text-sm text-gray-600">Muestra los pedidos seleccionados y los que siguen en camino.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={selectedDriverId}
                          onChange={(event) => setSelectedDriverId(event.target.value)}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                        >
                          <option value="">Seleccionar repartidor</option>
                          {drivers.filter((item) => item.is_active).map((item) => (
                            <option key={item.driver_id} value={item.driver_id}>{item.driver.full_name}</option>
                          ))}
                        </select>
                        {routeOrders.length > 0 ? (
                          <a href={routeWhatsAppUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition">
                            <MessageCircle className="w-4 h-4" />
                            Enviar por WhatsApp
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium opacity-50"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Enviar por WhatsApp
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleDispatchRoute}
                          disabled={pendingRouteOrders.length === 0 || !selectedDriverId || dispatchingRoute}
                          className="flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition"
                        >
                          <Bike className="w-4 h-4" />
                          {dispatchingRoute ? 'Asignando...' : 'Asignar hoja de ruta'}
                        </button>
                      </div>
                    </div>

                    {routeError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{routeError}</div>}
                    {drivers.filter((item) => item.is_active).length === 0 && (
                      <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
                        Primero cargá un repartidor desde la sección Repartidores.
                      </div>
                    )}

                    {routeOrders.length > 0 && (
                      <div className="mb-4 space-y-3">
                        <div className={`rounded-lg border px-3 py-2 text-sm ${
                          routeOrigin
                            ? 'border-cyan-100 bg-cyan-50 text-cyan-900'
                            : 'border-yellow-200 bg-yellow-50 text-yellow-900'
                        }`}>
                          {routeOrigin
                            ? `Origen: ${routeOrigin}`
                            : 'Falta la direccion del restaurante. El recorrido comenzara en la primera parada.'}
                        </div>
                        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
                          <iframe
                            title="Recorrido de la hoja de ruta"
                            src={routeEmbedUrl}
                            className="h-[360px] w-full sm:h-[440px]"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                      </div>
                    )}

                    {routeOrders.length === 0 ? (
                      <div className="border border-dashed border-gray-300 rounded-lg px-4 py-6 text-center text-sm text-gray-500">
                        Selecciona pedidos confirmados o en preparacion desde Pedidos para armar el reparto. Permaneceran aqui mientras esten en camino.
                      </div>
                    ) : (
                      <ol className="space-y-2">
                        {routeOrders.map((order, index) => (
                          <li key={order.id} className="flex items-start gap-3 border border-gray-200 rounded-lg p-3">
                            <button
                              type="button"
                              onClick={() => handleOpenOrderDetail(order.id)}
                              aria-label={`Ver detalle del pedido de ${getCustomerName(order)}`}
                              title="Ver detalle del pedido"
                              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-800 transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
                            >
                              <MapPin className="h-5 w-5" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800">Parada {index + 1} - #{order.id.slice(0, 8)} - {getCustomerName(order)}</p>
                              <button
                                type="button"
                                onClick={() => handleOpenOrderDetail(order.id)}
                                className="text-left text-sm text-gray-600 transition hover:text-cyan-700 hover:underline"
                              >
                                {getOrderAddressLabel(order)}
                              </button>
                              {order.customer?.phone && <p className="text-xs text-gray-500">{order.customer.phone}</p>}
                            </div>
                            {canAddToRoute(order) ? (
                              <button type="button" onClick={() => toggleRouteOrder(order.id)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                                Quitar
                              </button>
                            ) : (
                              <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-medium text-cyan-800">En camino</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    <div className="mt-8 border-t border-gray-200 pt-5">
                      <h3 className="font-semibold text-gray-800">Trazabilidad de rutas</h3>
                      <p className="mb-4 text-sm text-gray-500">Últimas hojas asignadas y estado de cada parada.</p>
                      {routes.length === 0 ? <p className="text-sm text-gray-500">Todavía no hay rutas registradas.</p> : (
                        <div className="space-y-3">
                          {routes.map((route) => {
                            const stops = [...route.delivery_route_orders].sort((a, b) => a.stop_sequence - b.stop_sequence);
                            return (
                              <div key={route.id} className="rounded-lg border border-gray-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div><p className="font-semibold text-gray-800">Ruta #{route.id.slice(0, 8)} · {route.driver.full_name}</p><p className="text-xs text-gray-500">Asignada {new Date(route.assigned_at).toLocaleString()}</p></div>
                                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${route.status === 'completed' ? 'bg-green-100 text-green-800' : route.status === 'in_progress' ? 'bg-cyan-100 text-cyan-800' : 'bg-blue-100 text-blue-800'}`}>
                                    {route.status === 'completed' ? 'Completada' : route.status === 'in_progress' ? 'En curso' : 'Asignada'}
                                  </span>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {stops.map((stop) => (
                                    <div key={stop.id} className="flex items-start justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
                                      <div><p className="font-medium text-gray-800">Parada {stop.stop_sequence} · #{stop.order.id.slice(0, 8)} · {getCustomerName(stop.order)}</p><p className="text-gray-500">{stop.order.delivery_address}</p>{stop.delivery_notes && <p className="mt-1 text-xs text-gray-500">Nota: {stop.delivery_notes}</p>}</div>
                                      <span className={`shrink-0 text-xs font-semibold ${stop.status === 'delivered' ? 'text-green-700' : 'text-cyan-700'}`}>
                                        {stop.delivered_at ? `Entregado ${new Date(stop.delivered_at).toLocaleString()}` : 'Pendiente'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {activeTab === 'drivers' && (
                  <section className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div><h2 className="text-xl font-bold text-gray-800">Repartidores</h2><p className="text-sm text-gray-600">Usuarios habilitados para recibir hojas de ruta de este restaurante.</p></div>
                      <button onClick={() => setShowDriverForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"><UserPlus className="h-4 w-4" />Nuevo repartidor</button>
                    </div>
                    {drivers.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">No hay repartidores cargados.</div> : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {drivers.map((item) => <div key={item.driver_id} className="rounded-lg border border-gray-200 p-4"><div className="flex items-center justify-between"><div><p className="font-semibold text-gray-800">{item.driver.full_name}</p><p className="text-sm text-gray-500">{item.driver.email}</p>{item.driver.phone && <p className="text-sm text-gray-500">{item.driver.phone}</p>}</div><span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{item.is_active ? 'Activo' : 'Inactivo'}</span></div></div>)}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </>
        )}
        </main>
      </div>

      {showMenuForm && selectedRestaurant && (
        <MenuItemForm
          restaurantId={selectedRestaurant.id}
          onClose={() => { setShowMenuForm(false); loadMenuItems(); }}
        />
      )}

      {showOrderForm && selectedRestaurant && (
        <RestaurantOrderForm
          restaurant={selectedRestaurant}
          menuItems={menuItems}
          onClose={() => setShowOrderForm(false)}
          onCreated={() => {
            setShowOrderForm(false);
            setActiveOrderGroupId('pending');
            loadOrders();
          }}
        />
      )}

      {editingItem && (
        <MenuItemEditForm
          item={editingItem}
          onClose={() => { setEditingItem(null); loadMenuItems(); }}
        />
      )}
      {showDriverForm && selectedRestaurant && (
        <DriverForm restaurantId={selectedRestaurant.id} onClose={() => { setShowDriverForm(false); loadDrivers(); }} />
      )}
    </div>
  );
}

function DriverForm({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { error: createError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: 'create',
        role: 'driver',
        restaurantId,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
      },
    });
    if (createError) {
      setError(createError.message);
      setLoading(false);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6">
        <h2 className="text-xl font-bold text-gray-800">Nuevo repartidor</h2>
        <p className="mb-5 mt-1 text-sm text-gray-500">Se creará un acceso asociado únicamente a este restaurante.</p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Nombre completo" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required minLength={6} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Contraseña (mínimo 6 caracteres)" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700">Cancelar</button><button disabled={loading} className="flex-1 rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Creando...' : 'Crear'}</button></div>
        </form>
      </div>
    </div>
  );
}

function RestaurantOrderForm({
  restaurant,
  menuItems,
  onClose,
  onCreated,
}: {
  restaurant: Restaurant;
  menuItems: MenuItem[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { getCurrentLocation, loading: geoLoading } = useGeolocation();
  type SelectableCustomer = {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    deliveryAddress: string;
  };

  const availableItems = menuItems.filter((item) => item.is_available);
  const [customer, setCustomer] = useState({ id: '', fullName: '', email: '', phone: '' });
  const [matchedCustomer, setMatchedCustomer] = useState(false);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [customerSearchMessage, setCustomerSearchMessage] = useState('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const [registeredCustomers, setRegisteredCustomers] = useState<SelectableCustomer[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const total = availableItems.reduce(
    (sum, item) => sum + item.price * (quantities[item.id] || 0),
    0,
  );

  function setQuantity(itemId: string, value: number) {
    setQuantities((current) => ({ ...current, [itemId]: Math.max(0, Math.floor(value || 0)) }));
  }

  async function openCustomerModal() {
    setShowCustomerModal(true);
    setCustomerFilter('');
    if (registeredCustomers.length > 0) return;
    setSearchingCustomer(true);
    setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-orders', {
      body: { action: 'listCustomers', restaurantId: restaurant.id },
    });
    setSearchingCustomer(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'No se pudo buscar al cliente.');
      setShowCustomerModal(false);
      return;
    }

    setRegisteredCustomers(Array.isArray(data.customers) ? data.customers : []);
  }

  function selectCustomer(selected: SelectableCustomer) {
    setMatchedCustomer(true);
    setCustomer({
      id: selected.id,
      fullName: selected.fullName || '',
      email: selected.email || '',
      phone: selected.phone || '',
    });
    setDeliveryAddress(selected.deliveryAddress || '');
    setCustomerSearchMessage('Cliente registrado asociado al pedido.');
    setShowCustomerModal(false);
  }

  function clearSelectedCustomer() {
    setMatchedCustomer(false);
    setCustomer({ id: '', fullName: '', email: '', phone: '' });
    setDeliveryAddress('');
    setCustomerSearchMessage('');
  }

  const normalizedCustomerFilter = customerFilter.trim().toLocaleLowerCase('es');
  const filteredCustomers = registeredCustomers.filter((registeredCustomer) =>
    registeredCustomer.fullName?.toLocaleLowerCase('es').includes(normalizedCustomerFilter),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const items = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));

    if (items.length === 0) {
      setError('Selecciona al menos un producto.');
      return;
    }

    let addressToSave = deliveryAddress.trim();
    if (deliveryMethod === 'delivery') {
      const currentLocation = await getCurrentLocation();
      addressToSave = addDefaultLocality(addressToSave, currentLocation?.locality);
    }

    setLoading(true);
    setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-orders', {
      body: {
        restaurantId: restaurant.id,
        customer,
        deliveryMethod,
        deliveryAddress: addressToSave,
        latitude: null,
        longitude: null,
        customerNotes,
        items,
      },
    });
    setLoading(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'No se pudo crear el pedido.');
      return;
    }

    alert('Pedido creado correctamente.');
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Nuevo pedido</h2>
            <p className="text-sm text-gray-600">Selecciona un cliente registrado por nombre y apellido o carga un cliente ocasional.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
            <h3 className="font-semibold text-gray-800 sm:col-span-2">Cliente</h3>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="button" onClick={openCustomerModal} disabled={searchingCustomer} className="inline-flex items-center gap-2 rounded-lg border border-orange-500 px-4 py-2 font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50">
                <Search className="h-4 w-4" />
                {searchingCustomer ? 'Cargando clientes...' : 'Buscar cliente registrado'}
              </button>
              {matchedCustomer && <button type="button" onClick={clearSelectedCustomer} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50">Quitar seleccion</button>}
            </div>
            <input required type="text" placeholder="Nombre y apellido" value={customer.fullName} readOnly={matchedCustomer} onChange={(e) => setCustomer({ ...customer, fullName: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-orange-500 read-only:bg-gray-100" />
            {matchedCustomer && <input type="tel" value={customer.phone} readOnly placeholder="Sin telefono registrado" className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-600" />}
            {matchedCustomer && <input type="email" value={customer.email} readOnly placeholder="Sin correo registrado" className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-600 sm:col-span-2" />}
            {customerSearchMessage && <p className={`text-sm sm:col-span-2 ${matchedCustomer ? 'text-green-700' : 'text-gray-600'}`}>{customerSearchMessage}</p>}
          </section>

          <section className="rounded-lg border border-gray-200 p-4">
            <h3 className="mb-3 font-semibold text-gray-800">Productos</h3>
            {availableItems.length === 0 ? (
              <p className="text-sm text-gray-500">No hay productos disponibles.</p>
            ) : (
              <div className="space-y-2">
                {availableItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-500">{moneyFormatter.format(item.price)}</p>
                    </div>
                    <input type="number" min="0" step="1" value={quantities[item.id] || ''} onChange={(e) => setQuantity(item.id, Number(e.target.value))} className="w-20 rounded-md border border-gray-300 px-2 py-1 text-center" aria-label={`Cantidad de ${item.name}`} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
            <h3 className="font-semibold text-gray-800 sm:col-span-2">Entrega</h3>
            <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as 'delivery' | 'pickup')} className="rounded-lg border border-gray-300 px-3 py-2">
              <option value="delivery">Entrega a domicilio</option>
              <option value="pickup">Retira en el restaurante</option>
            </select>
            {deliveryMethod === 'delivery' ? (
              <input required type="text" placeholder="Direccion de entrega" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />
            ) : (
              <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{restaurant.address || 'Retira en el restaurante'}</div>
            )}
            <textarea placeholder="Notas del pedido" rows={2} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2" />
          </section>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg font-bold text-gray-800">Total: {moneyFormatter.format(total)}</p>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={loading || geoLoading || availableItems.length === 0} className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                {geoLoading ? 'Ubicando...' : loading ? 'Creando...' : 'Crear pedido'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {showCustomerModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Clientes registrados</h3>
                <p className="text-sm text-gray-600">Busca por nombre o apellido y selecciona un cliente.</p>
              </div>
              <button type="button" onClick={() => setShowCustomerModal(false)} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Cerrar clientes"><X className="h-5 w-5" /></button>
            </div>
            <div className="border-b border-gray-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input autoFocus type="search" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} placeholder="Filtrar por nombre y apellido..." className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 focus:ring-2 focus:ring-orange-500" />
              </div>
            </div>
            <div className="overflow-auto">
              {searchingCustomer ? (
                <p className="p-8 text-center text-gray-500">Cargando clientes...</p>
              ) : filteredCustomers.length === 0 ? (
                <p className="p-8 text-center text-gray-500">No se encontraron clientes.</p>
              ) : (
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">Nombre y apellido</th><th className="px-4 py-3">Telefono</th><th className="px-4 py-3">Correo</th><th className="px-4 py-3 text-right">Accion</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCustomers.map((registeredCustomer) => (
                      <tr key={registeredCustomer.id} className="hover:bg-orange-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{registeredCustomer.fullName || 'Sin nombre'}</td>
                        <td className="px-4 py-3 text-gray-600">{registeredCustomer.phone || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{registeredCustomer.email || '-'}</td>
                        <td className="px-4 py-3 text-right"><button type="button" onClick={() => selectCustomer(registeredCustomer)} className="rounded-lg bg-orange-500 px-3 py-2 font-medium text-white hover:bg-orange-600">Seleccionar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItemForm({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
  });
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [loading, setLoading] = useState(false);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  async function uploadImage(): Promise<string | null> {
    if (!image) return null;

    const fileExt = image.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from('menu-items')
      .upload(`${restaurantId}/${fileName}`, image);

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    const { data: publicData } = supabase.storage
      .from('menu-items')
      .getPublicUrl(`${restaurantId}/${fileName}`);

    return publicData.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = null;
      if (image) {
        imageUrl = await uploadImage();
      }

      await supabase.from('menu_items').insert({
        restaurant_id: restaurantId,
        name: formData.name,
        description: formData.description,
        price: parseFloat(formData.price),
        category: formData.category,
        image_url: imageUrl,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Agregar Platillo</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Foto del Platillo</label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
            {imagePreview && (
              <div className="mt-2 relative">
                <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Precio</label>
            <input
              type="number"
              step="0.01"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Categoría</label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="Ej: Entrada, Plato Principal, Postre"
            />
          </div>
          <div className="flex gap-3">
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
              {loading ? 'Cargando...' : 'Agregar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MenuItemEditForm({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: item.name,
    description: item.description || '',
    price: item.price.toString(),
    category: item.category || '',
  });
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>(item.image_url || '');
  const [loading, setLoading] = useState(false);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  async function uploadImage(): Promise<string> {
    if (!image) return imagePreview;

    const fileExt = image.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from('menu-items')
      .upload(`${item.restaurant_id}/${fileName}`, image);

    if (error) {
      console.error('Upload error:', error);
      return imagePreview;
    }

    const { data: publicData } = supabase.storage
      .from('menu-items')
      .getPublicUrl(`${item.restaurant_id}/${fileName}`);

    return publicData.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      let imageUrl = imagePreview;
      if (image) {
        imageUrl = await uploadImage();
      }

      await supabase
        .from('menu_items')
        .update({
          name: formData.name,
          description: formData.description,
          price: parseFloat(formData.price),
          category: formData.category,
          image_url: imageUrl,
        })
        .eq('id', item.id);
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Editar Platillo</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Foto del Platillo</label>
            <div className="relative">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
            {imagePreview && (
              <div className="mt-2 relative">
                <img src={imagePreview} alt="Preview" className="w-full h-32 object-cover rounded-lg" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Precio</label>
            <input
              type="number"
              step="0.01"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Categoría</label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              placeholder="Ej: Entrada, Plato Principal, Postre"
            />
          </div>
          <div className="flex gap-3">
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
              {loading ? 'Cargando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
