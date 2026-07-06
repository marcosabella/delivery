import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, DishCategory, Restaurant, RestaurantTable, RestaurantReservation, MenuItem, Order } from '../lib/supabase';
import { useGeolocation } from '../hooks/useGeolocation';
import { addDefaultLocality } from '../lib/address';
import { openOrderTicket, PrintableOrderTicket } from '../lib/orderTicket';
import { notifyCustomerOrderStatus, shouldNotifyCustomerOrderStatus } from '../lib/orderStatusNotifications';
import { TableCloseModal } from './TableCloseModal';
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
  Printer,
  UserPlus,
  Users,
  Hash,
  CalendarDays,
  BellRing,
} from 'lucide-react';

type RestaurantOrder = Order & {
  customer?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
  order_items?: Array<{
    id: string;
    menu_item_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    menu_item?: {
      name: string | null;
      category: string | null;
    } | null;
  }>;
  dining_table?: {
    table_number: number;
    label: string | null;
  } | null;
  waiter?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type OrderGroupId = 'pending' | 'kitchen' | 'delivery' | 'closed';
type HistoryPeriod = 'today' | '7days' | '30days' | 'all';
type RestaurantTab = 'menu' | 'orders' | 'route' | 'drivers' | 'waiters' | 'tables' | 'reservations';

type ReservationStatus = RestaurantReservation['status'];

type RestaurantReservationWithTable = RestaurantReservation & {
  table?: {
    table_number: number;
    label: string | null;
  } | null;
};

type ReservationInput = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  reservationAt: string;
  partySize: string;
  tableId: string;
  status: ReservationStatus;
  notes: string;
};

type RestaurantDriver = {
  driver_id: string;
  is_active: boolean;
  driver: { id: string; full_name: string; email: string; phone: string | null };
};

type RestaurantWaiter = {
  waiter_id: string;
  is_active: boolean;
  waiter: { id: string; full_name: string; email: string; phone: string | null };
};

type OrderProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type FallbackOrderItem = NonNullable<RestaurantOrder['order_items']>[number] & {
  order_id: string;
  menu_item?: { name: string | null; category: string | null } | Array<{ name: string | null; category: string | null }> | null;
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

const historyPeriodOptions: Array<{ value: HistoryPeriod; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: '7days', label: 'Últimos 7 días' },
  { value: '30days', label: 'Últimos 30 días' },
  { value: 'all', label: 'Todo el historial' },
];

const reservationStatusLabels: Record<ReservationStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
};

const reservationStatusColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-green-100 text-green-800',
};

function getHistoryPeriodStart(period: HistoryPeriod) {
  if (period === 'all') return null;

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === '7days') start.setDate(start.getDate() - 6);
  if (period === '30days') start.setDate(start.getDate() - 29);

  return start;
}

function isWithinHistoryPeriod(dateValue: string, period: HistoryPeriod) {
  const start = getHistoryPeriodStart(period);
  if (!start) return true;

  return new Date(dateValue) >= start;
}

export function RestaurantDashboard() {
  const { profile, signOut } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [dishCategories, setDishCategories] = useState<DishCategory[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [reservations, setReservations] = useState<RestaurantReservationWithTable[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [activeTab, setActiveTab] = useState<RestaurantTab>('orders');
  const [activeOrderGroupId, setActiveOrderGroupId] = useState<OrderGroupId>('pending');
  const [orderHistoryPeriod, setOrderHistoryPeriod] = useState<HistoryPeriod>('today');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [routeOrderIds, setRouteOrderIds] = useState<string[]>([]);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [drivers, setDrivers] = useState<RestaurantDriver[]>([]);
  const [waiters, setWaiters] = useState<RestaurantWaiter[]>([]);
  const [routes, setRoutes] = useState<RouteHistory[]>([]);
  const [routeHistoryPeriod, setRouteHistoryPeriod] = useState<HistoryPeriod>('today');
  const [activeRouteOrderIds, setActiveRouteOrderIds] = useState<Set<string>>(new Set());
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [editingDriver, setEditingDriver] = useState<RestaurantDriver | null>(null);
  const [showWaiterForm, setShowWaiterForm] = useState(false);
  const [editingWaiter, setEditingWaiter] = useState<RestaurantWaiter | null>(null);
  const [editingReservation, setEditingReservation] = useState<RestaurantReservationWithTable | null>(null);
  const [closingTableOrder, setClosingTableOrder] = useState<RestaurantOrder | null>(null);
  const [closingTable, setClosingTable] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [orderLoadError, setOrderLoadError] = useState('');
  const [dispatchingRoute, setDispatchingRoute] = useState(false);
  const [orderNotification, setOrderNotification] = useState<{ count: number; message: string } | null>(null);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedOrdersRef = useRef(false);

  useEffect(() => {
    if (profile) {
      loadRestaurants();
      loadDishCategories();
    }
  }, [profile]);

  useEffect(() => {
    if (selectedRestaurant) {
      loadMenuItems();
      loadOrders();
      loadDrivers();
      loadWaiters();
      loadTables();
      loadReservations();
    }
  }, [selectedRestaurant]);

  useEffect(() => {
    if (selectedRestaurant) loadRoutes();
  }, [selectedRestaurant, routeHistoryPeriod]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    const channel = supabase
      .channel(`restaurant-routes-${selectedRestaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_routes', filter: `restaurant_id=eq.${selectedRestaurant.id}` }, () => void loadRoutes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_route_orders' }, () => { void loadRoutes(); void loadOrders(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedRestaurant, routeHistoryPeriod]);

  useEffect(() => {
    if (!orderNotification) return;
    const timeoutId = window.setTimeout(() => setOrderNotification(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [orderNotification]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    knownOrderIdsRef.current = new Set();
    hasLoadedOrdersRef.current = false;
    setOrderNotification(null);
    const channel = supabase
      .channel(`restaurant-orders-${selectedRestaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${selectedRestaurant.id}` }, () => void loadOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => void loadOrders())
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

  async function loadDishCategories() {
    const { data } = await supabase
      .from('dish_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('name');

    if (data) setDishCategories(data);
  }

  async function loadOrders() {
    if (!selectedRestaurant) return;

    setOrderLoadError('');

    const fullQuery = supabase
      .from('orders')
      .select(`
        *,
        customer:profiles!orders_customer_id_fkey (full_name, email, phone),
        order_items (
          id,
          menu_item_id,
          quantity,
          unit_price,
          subtotal,
          menu_item:menu_items (name, category)
        ),
        dining_table:restaurant_tables (table_number, label),
        waiter:profiles!orders_waiter_id_fkey (full_name, email)
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at', { ascending: false });

    const { data, error } = await fullQuery;
    let loadedOrders = data as RestaurantOrder[] | null;

    if (error) {
      console.error('Error loading orders with related data:', error);

      const fallbackResult = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', selectedRestaurant.id)
        .order('created_at', { ascending: false });

      if (fallbackResult.error) {
        console.error('Error loading orders:', fallbackResult.error);
        setOrderLoadError(`No se pudieron cargar los pedidos: ${fallbackResult.error.message}`);
        setOrders([]);
        return;
      }

      const baseOrders = (fallbackResult.data || []) as RestaurantOrder[];
      const orderIds = baseOrders.map((order) => order.id);
      const profileIds = Array.from(new Set(
        baseOrders
          .flatMap((order) => [order.customer_id, order.waiter_id])
          .filter((id): id is string => Boolean(id))
      ));
      const tableIds = Array.from(new Set(
        baseOrders
          .map((order) => order.dining_table_id)
          .filter((id): id is string => Boolean(id))
      ));

      const [itemsResult, profilesResult, tablesResult] = await Promise.all([
        orderIds.length > 0
          ? supabase
            .from('order_items')
            .select(`
              id,
              order_id,
              menu_item_id,
              quantity,
              unit_price,
              subtotal,
              menu_item:menu_items (name, category)
            `)
            .in('order_id', orderIds)
          : Promise.resolve({ data: [], error: null }),
        profileIds.length > 0
          ? supabase
            .from('profiles')
            .select('id, full_name, email, phone')
            .in('id', profileIds)
          : Promise.resolve({ data: [], error: null }),
        tableIds.length > 0
          ? supabase
            .from('restaurant_tables')
            .select('id, table_number, label')
            .in('id', tableIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (itemsResult.error) console.error('Error loading order items:', itemsResult.error);
      if (profilesResult.error) console.error('Error loading order profiles:', profilesResult.error);
      if (tablesResult.error) console.error('Error loading order tables:', tablesResult.error);

      const itemsByOrder = new Map<string, RestaurantOrder['order_items']>();
      for (const item of (itemsResult.data || []) as unknown as FallbackOrderItem[]) {
        const currentItems = itemsByOrder.get(item.order_id) || [];
        currentItems.push({
          ...item,
          menu_item: Array.isArray(item.menu_item) ? item.menu_item[0] || null : item.menu_item,
        });
        itemsByOrder.set(item.order_id, currentItems);
      }

      const profilesById = new Map(
        ((profilesResult.data || []) as OrderProfile[]).map((profile) => [profile.id, profile])
      );
      const tablesById = new Map(
        ((tablesResult.data || []) as Array<{ id: string; table_number: number; label: string | null }>).map((table) => [table.id, table])
      );

      loadedOrders = baseOrders.map((order) => ({
        ...order,
        customer: order.customer_id ? profilesById.get(order.customer_id) : undefined,
        waiter: order.waiter_id ? profilesById.get(order.waiter_id) : undefined,
        dining_table: order.dining_table_id ? tablesById.get(order.dining_table_id) || null : null,
        order_items: itemsByOrder.get(order.id) || [],
      }));
    }

    const safeOrders = loadedOrders || [];
    const previousOrderIds = knownOrderIdsRef.current;
    const isRefreshAfterInitialLoad = hasLoadedOrdersRef.current;
    const newPendingOrders = safeOrders.filter((order) => order.status === 'pending' && !previousOrderIds.has(order.id));
    knownOrderIdsRef.current = new Set(safeOrders.map((order) => order.id));
    hasLoadedOrdersRef.current = true;

    if (isRefreshAfterInitialLoad && newPendingOrders.length > 0) {
      const dineInCount = newPendingOrders.filter((order) => order.delivery_method === 'dine_in').length;
      const message = dineInCount === newPendingOrders.length
        ? dineInCount === 1 ? 'Nuevo pedido de mesa recibido.' : `${dineInCount} nuevos pedidos de mesa recibidos.`
        : newPendingOrders.length === 1 ? 'Nuevo pedido recibido.' : `${newPendingOrders.length} nuevos pedidos recibidos.`;
      setOrderNotification({ count: newPendingOrders.length, message });
    }

    setOrders(safeOrders);
    setSelectedOrderId((currentId) => {
      if (currentId && safeOrders.some((order) => order.id === currentId)) return currentId;
      setShowOrderDetail(false);
      return null;
    });
    setRouteOrderIds((currentIds) =>
      currentIds.filter((id) =>
        safeOrders.some((order) => order.id === id && canAddToRoute(order))
      )
    );
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

  async function loadWaiters() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('restaurant_waiters')
      .select('waiter_id, is_active, waiter:profiles!restaurant_waiters_waiter_id_fkey (id, full_name, email, phone)')
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at');
    setWaiters((data || []) as unknown as RestaurantWaiter[]);
  }

  async function loadTables() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.id)
      .order('table_number', { ascending: true });

    if (data) setTables(data as RestaurantTable[]);
  }

  async function loadReservations() {
    if (!selectedRestaurant) return;

    const { data } = await supabase
      .from('restaurant_reservations')
      .select('*, table:restaurant_tables (table_number, label)')
      .eq('restaurant_id', selectedRestaurant.id)
      .order('reservation_at', { ascending: true });

    if (data) setReservations(data as RestaurantReservationWithTable[]);
  }

  async function handleSaveReservation(form: ReservationInput, reservationId?: string) {
    if (!selectedRestaurant) return;

    const payload = {
      restaurant_id: selectedRestaurant.id,
      table_id: form.tableId || null,
      customer_name: form.customerName.trim(),
      customer_phone: form.customerPhone.trim() || null,
      customer_email: form.customerEmail.trim() || null,
      reservation_at: new Date(form.reservationAt).toISOString(),
      party_size: form.partySize ? Number(form.partySize) : null,
      status: form.status,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (reservationId) {
      await supabase
        .from('restaurant_reservations')
        .update(payload)
        .eq('id', reservationId);
      setEditingReservation(null);
    } else {
      await supabase
        .from('restaurant_reservations')
        .insert(payload);
    }

    loadReservations();
  }

  async function handleUpdateReservationStatus(reservationId: string, status: ReservationStatus) {
    await supabase
      .from('restaurant_reservations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', reservationId);
    loadReservations();
  }

  async function handleDeleteReservation(reservationId: string) {
    await supabase.from('restaurant_reservations').delete().eq('id', reservationId);
    loadReservations();
  }

  async function handleCreateTable(tableNumber: number, seats: number | null) {
    if (!selectedRestaurant) return;
    await supabase
      .from('restaurant_tables')
      .insert({
        restaurant_id: selectedRestaurant.id,
        table_number: tableNumber,
        seats,
      });
    loadTables();
  }

  async function handleToggleTable(table: RestaurantTable) {
    await supabase
      .from('restaurant_tables')
      .update({ is_active: !table.is_active, updated_at: new Date().toISOString() })
      .eq('id', table.id);
    loadTables();
  }

  async function handleDeleteTable(tableId: string) {
    await supabase.from('restaurant_tables').delete().eq('id', tableId);
    loadTables();
  }

  async function loadRoutes() {
    if (!selectedRestaurant) return;
    let routesQuery = supabase
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
      .order('created_at', { ascending: false });
    const historyStart = getHistoryPeriodStart(routeHistoryPeriod);
    if (historyStart) routesQuery = routesQuery.gte('assigned_at', historyStart.toISOString());

    const [{ data }, { data: activeRouteOrders }] = await Promise.all([
      routesQuery,
      supabase
        .from('delivery_route_orders')
        .select('order_id, route:delivery_routes!inner(restaurant_id, status)')
        .eq('route.restaurant_id', selectedRestaurant.id)
        .in('route.status', ['assigned', 'in_progress']),
    ]);
    if (data) setRoutes(data as unknown as RouteHistory[]);
    setActiveRouteOrderIds(new Set((activeRouteOrders || []).map((item) => item.order_id)));
  }

  async function handleUpdateOrderStatus(orderId: string, status: Order['status']) {
    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (!error && shouldNotifyCustomerOrderStatus(status)) void notifyCustomerOrderStatus(orderId);
    void loadOrders();
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
    else {
      routeOrderIds.forEach((orderId) => void notifyCustomerOrderStatus(orderId));
      setRouteOrderIds([]);
    }
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
    closed: 'bg-slate-100 text-slate-700',
    cancelled: 'bg-red-100 text-red-800',
  };

  const statusLabels: Record<Order['status'], string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    preparing: 'Preparando',
    delivering: 'En camino',
    delivered: 'Entregado',
    closed: 'Mesa cerrada',
    cancelled: 'Cancelado',
  };

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || null;
  const pendingRouteOrders = routeOrderIds
    .map((id) => orders.find((order) => order.id === id))
    .filter((order): order is RestaurantOrder => {
      if (!order) return false;
      return canAddToRoute(order);
    });
  const availableRouteOrders = orders.filter(
    (order) => canAddToRoute(order) && !routeOrderIds.includes(order.id)
  );
  const routeOrders = [
    ...orders.filter((order) => order.status === 'delivering' && activeRouteOrderIds.has(order.id)),
    ...pendingRouteOrders,
  ];
  const closedOrders = orders.filter(
    (order) =>
      (order.status === 'delivered' || order.status === 'closed' || order.status === 'cancelled')
      && isWithinHistoryPeriod(order.updated_at || order.created_at, orderHistoryPeriod)
  );
  const pendingOrderCount = orders.filter((order) => order.status === 'pending').length;
  const filteredRoutes = routes.filter((route) => isWithinHistoryPeriod(route.assigned_at, routeHistoryPeriod));
  const orderGroups: Array<{ id: OrderGroupId; title: string; icon: typeof Clock; orders: RestaurantOrder[] }> = [
    { id: 'pending', title: 'Nuevos', icon: Clock, orders: orders.filter((order) => order.status === 'pending') },
    { id: 'kitchen', title: 'Cocina', icon: ChefHat, orders: orders.filter((order) => order.status === 'confirmed' || order.status === 'preparing') },
    { id: 'delivery', title: 'Reparto', icon: Bike, orders: orders.filter((order) => order.status === 'delivering') },
    { id: 'closed', title: 'Entregados/Cerrados', icon: CheckCircle2, orders: closedOrders },
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

  function isDineInOrder(order: RestaurantOrder) {
    return order.delivery_method === 'dine_in';
  }

  function canAddToRoute(order: RestaurantOrder) {
    return !isPickupOrder(order)
      && (order.status === 'confirmed' || order.status === 'preparing' || order.status === 'delivering')
      && !activeRouteOrderIds.has(order.id);
  }

  function getFulfillmentLabel(order: RestaurantOrder) {
    if (isDineInOrder(order)) return 'Pedido de mesa';
    return isPickupOrder(order) ? 'Retira en restaurante' : 'Entrega a domicilio';
  }

  function getOrderAddressLabel(order: RestaurantOrder) {
    if (isDineInOrder(order)) {
      const tableNumber = order.dining_table?.table_number;
      const label = order.dining_table?.label?.trim();
      return tableNumber ? `Mesa ${tableNumber}${label ? ` - ${label}` : ''}` : order.delivery_address;
    }
    return isPickupOrder(order)
      ? `Retiro en restaurante${order.delivery_address ? ` - ${order.delivery_address}` : ''}`
      : order.delivery_address;
  }

  function getOrderLocationQuery(order: RestaurantOrder) {
    if (isDineInOrder(order)) return selectedRestaurant?.address?.trim() || '';
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
    if ((isPickupOrder(order) || isDineInOrder(order)) && order.status === 'preparing') return 'delivered';
    if (order.status === 'preparing') return 'delivering';
    if (order.status === 'delivering') return 'delivered';
    return null;
  }

  function getNextStatusLabel(order: RestaurantOrder) {
    if (order.status === 'pending') return 'Confirmar';
    if (order.status === 'confirmed') return 'Preparar';
    if ((isPickupOrder(order) || isDineInOrder(order)) && order.status === 'preparing') return 'Entregar';
    if (order.status === 'preparing') return 'Enviar';
    if (order.status === 'delivering') return 'Entregar';
    return '';
  }

  function handleCloseTableOrder(order: RestaurantOrder) {
    setClosingTableOrder(order);
  }

  async function confirmCloseTableOrder() {
    if (!closingTableOrder) return;
    setClosingTable(true);
    await handleUpdateOrderStatus(closingTableOrder.id, 'closed');
    setClosingTable(false);
    setClosingTableOrder(null);
  }

  function getCustomerName(order: RestaurantOrder) {
    const name = order.customer?.full_name?.trim();
    const email = order.customer?.email?.trim();
    const phone = order.customer?.phone?.trim();
    const guestName = order.guest_customer_name?.trim();
    if (isDineInOrder(order) && !name && !email && !phone && !guestName) return getOrderAddressLabel(order);
    return name || email || phone || guestName || (order.customer_id
      ? `Cliente #${order.customer_id.slice(0, 8)}`
      : 'Cliente sin registrar');
  }

  function getWaiterName(order: RestaurantOrder) {
    return order.waiter?.full_name?.trim() || order.waiter?.email?.trim() || '';
  }

  function buildOrderTicket(order: RestaurantOrder): PrintableOrderTicket {
    const waiterName = getWaiterName(order);

    return {
      orderId: order.id,
      customerName: getCustomerName(order),
      deliveryAddress: getOrderAddressLabel(order),
      tableLabel: isDineInOrder(order) ? getOrderAddressLabel(order) : undefined,
      waiterName: isDineInOrder(order) ? waiterName || 'No informado' : undefined,
      totalAmount: order.total_amount,
      notes: order.customer_notes,
      items: (order.order_items || []).map((item) => ({
        name: item.menu_item?.name || 'Producto',
        quantity: item.quantity,
        subtotal: item.subtotal,
      })),
    };
  }

  function handlePrintOrderTicket(order: RestaurantOrder) {
    const printed = openOrderTicket(selectedRestaurant?.name || 'Restaurante', {
      orderId: order.id,
      customerName: getCustomerName(order),
      deliveryAddress: getOrderAddressLabel(order),
      tableLabel: isDineInOrder(order) ? getOrderAddressLabel(order) : undefined,
      waiterName: isDineInOrder(order) ? getWaiterName(order) || 'No informado' : undefined,
      totalAmount: order.total_amount,
      items: (order.order_items || []).map((item) => ({
        name: item.menu_item?.name || 'Producto',
        quantity: item.quantity,
        subtotal: item.subtotal,
      })),
    });
    if (!printed) window.alert('El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes e intentá nuevamente.');
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
                  {isDineInOrder(order) ? (
                    <Hash className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                  ) : isPickupOrder(order) ? (
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
                {isDineInOrder(order) && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <UserPlus className="w-4 h-4 text-gray-500" />
                    <span>Mozo: {getWaiterName(order) || 'No informado'}</span>
                  </div>
                )}
                {!isDineInOrder(order) && (
                  <>
                <div className="rounded-lg overflow-hidden border border-gray-200 h-56">
                  <iframe title={`Ubicación del pedido ${order.id}`} src={getOrderEmbedUrl(order)} className="w-full h-full" loading="lazy" />
                </div>
                <a href={getOrderMapUrl(order)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                  <Navigation className="w-4 h-4" />
                  Abrir ubicación
                </a>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => handlePrintOrderTicket(order)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition"
              >
                <Printer className="w-4 h-4" />
                Imprimir ticket
              </button>
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
              {isDineInOrder(order) && order.status === 'delivered' && (
                <button
                  type="button"
                  onClick={() => handleCloseTableOrder(order)}
                  className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Cerrar mesa
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const restaurantNavItems = [
    { id: 'orders' as const, label: 'Pedidos', icon: PackageCheck, count: pendingOrderCount },
    { id: 'route' as const, label: 'Hoja de ruta', icon: Route },
    { id: 'tables' as const, label: 'Mesas', icon: Hash },
    { id: 'reservations' as const, label: 'Reservas', icon: CalendarDays },
    { id: 'menu' as const, label: 'Menu', icon: UtensilsCrossed },
    { id: 'drivers' as const, label: 'Repartidores', icon: Users },
    { id: 'waiters' as const, label: 'Mozos', icon: UserPlus },
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
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {'count' in item && (item.count ?? 0) > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isActive ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {item.count ?? 0}
                  </span>
                )}
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
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {'count' in item && (item.count ?? 0) > 0 && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isActive ? 'bg-orange-600 text-white' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {item.count ?? 0}
                      </span>
                    )}
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
        {orderNotification && (
          <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
                  <BellRing className="h-4 w-4" />
                  <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-4 text-white">
                    {orderNotification.count}
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-orange-900">{orderNotification.message}</p>
                  <p className="text-xs text-orange-700">Pendientes: {pendingOrderCount}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('orders');
                  setActiveOrderGroupId('pending');
                  setShowOrderDetail(false);
                  setOrderNotification(null);
                }}
                className="self-start rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 sm:self-auto"
              >
                Ver pedidos
              </button>
            </div>
          </div>
        )}
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

                    {orderLoadError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p>{orderLoadError}</p>
                          <button
                            type="button"
                            onClick={() => void loadOrders()}
                            className="self-start rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 sm:self-auto"
                          >
                            Reintentar
                          </button>
                        </div>
                      </div>
                    )}

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
                              <div className="flex items-center gap-3">
                                {activeOrderGroupId === 'closed' && (
                                  <select
                                    value={orderHistoryPeriod}
                                    onChange={(event) => setOrderHistoryPeriod(event.target.value as HistoryPeriod)}
                                    aria-label="Filtrar historial de pedidos"
                                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                                  >
                                    {historyPeriodOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                )}
                                <span className="text-xs font-semibold text-gray-500">{activeOrderGroup.orders.length}</span>
                              </div>
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
                                      <th className="w-[10%] px-2 py-2 text-left font-semibold">Mozo</th>
                                      <th className="w-[12%] px-2 py-2 text-left font-semibold">Fecha</th>
                                      <th className="w-[15%] px-2 py-2 text-left font-semibold">Entrega</th>
                                      <th className="w-[8%] px-2 py-2 text-right font-semibold">Total</th>
                                      <th className="w-[5%] px-2 py-2 text-center font-semibold">Items</th>
                                      <th className="w-[10%] px-2 py-2 text-left font-semibold">Estado</th>
                                      <th className="w-[18%] px-2 py-2 text-right font-semibold">Acciones</th>
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
                                          <td className="min-w-0 px-2 py-2 align-middle">
                                            {order.waiter_id || getWaiterName(order) ? (
                                              <p className="truncate font-medium text-gray-700" title={getWaiterName(order) || 'No informado'}>
                                                {getWaiterName(order) || 'No informado'}
                                              </p>
                                            ) : (
                                              <p className="truncate text-gray-400">No informado</p>
                                            )}
                                          </td>
                                          <td className="whitespace-nowrap px-2 py-2 align-middle text-gray-700">
                                            {new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                          </td>
                                          <td className="min-w-0 px-2 py-2 align-middle text-gray-600">
                                            <div className="flex items-center gap-1.5">
                                              {isDineInOrder(order) ? (
                                                <Hash className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                                              ) : isPickupOrder(order) ? (
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
                                                onClick={() => handlePrintOrderTicket(order)}
                                                className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
                                              >
                                                <Printer className="h-3.5 w-3.5" />
                                                Ticket
                                              </button>
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
                                              {isDineInOrder(order) && order.status === 'delivered' && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleCloseTableOrder(order)}
                                                  className="inline-flex items-center justify-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-green-700"
                                                >
                                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                                  Cerrar mesa
                                                </button>
                                              )}
                                              {order.status !== 'delivered' && order.status !== 'closed' && order.status !== 'cancelled' && (
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
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-gray-800">Hoja de ruta</h2>
                        <p className="text-sm text-gray-600">Muestra los pedidos seleccionados y los que siguen en camino. También podés asignar pedidos en reparto que hayan quedado sin hoja de ruta.</p>
                      </div>
                      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] lg:w-auto">
                        <select
                          value={selectedDriverId}
                          onChange={(event) => setSelectedDriverId(event.target.value)}
                          className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                        >
                          <option value="">Seleccionar repartidor</option>
                          {drivers.filter((item) => item.is_active).map((item) => (
                            <option key={item.driver_id} value={item.driver_id}>{item.driver.full_name}</option>
                          ))}
                        </select>
                        {routeOrders.length > 0 ? (
                          <a href={routeWhatsAppUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 whitespace-nowrap px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition">
                            <MessageCircle className="w-4 h-4" />
                            Enviar por WhatsApp
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="flex items-center justify-center gap-2 whitespace-nowrap px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium opacity-50"
                          >
                            <MessageCircle className="w-4 h-4" />
                            Enviar por WhatsApp
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleDispatchRoute}
                          disabled={pendingRouteOrders.length === 0 || !selectedDriverId || dispatchingRoute}
                          className="flex items-center justify-center gap-2 whitespace-nowrap px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:hover:bg-cyan-600 text-white rounded-lg text-sm font-medium transition"
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

                    {availableRouteOrders.length > 0 && (
                      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <h3 className="font-semibold text-gray-800">Pedidos disponibles</h3>
                        <p className="mb-3 text-sm text-gray-500">Agregá los pedidos que querés asignar al repartidor seleccionado.</p>
                        <div className="space-y-2">
                          {availableRouteOrders.map((order) => (
                            <div key={order.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-gray-800">#{order.id.slice(0, 8)} - {getCustomerName(order)}</p>
                                <p className="truncate text-sm text-gray-600">{getOrderAddressLabel(order)}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleRouteOrder(order.id)}
                                className="flex-shrink-0 rounded-lg bg-cyan-100 px-3 py-2 text-sm font-medium text-cyan-800 transition hover:bg-cyan-200"
                              >
                                Agregar
                              </button>
                            </div>
                          ))}
                        </div>
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
                        Selecciona pedidos confirmados, en preparacion o en reparto sin hoja asignada desde Pedidos para armar el recorrido.
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
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-gray-800">Trazabilidad de rutas</h3>
                          <p className="text-sm text-gray-500">Hojas asignadas y estado de cada parada.</p>
                        </div>
                        <select
                          value={routeHistoryPeriod}
                          onChange={(event) => setRouteHistoryPeriod(event.target.value as HistoryPeriod)}
                          aria-label="Filtrar historial de hojas de ruta"
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                        >
                          {historyPeriodOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      {filteredRoutes.length === 0 ? <p className="text-sm text-gray-500">No hay rutas para el período seleccionado.</p> : (
                        <div className="space-y-3">
                          {filteredRoutes.map((route) => {
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

                {activeTab === 'tables' && selectedRestaurant && (
                  <TableSettings
                    tables={tables}
                    onCreate={handleCreateTable}
                    onToggle={handleToggleTable}
                    onDelete={handleDeleteTable}
                  />
                )}

                {activeTab === 'reservations' && selectedRestaurant && (
                  <ReservationSettings
                    reservations={reservations}
                    tables={tables}
                    editingReservation={editingReservation}
                    onEdit={setEditingReservation}
                    onCancelEdit={() => setEditingReservation(null)}
                    onSave={handleSaveReservation}
                    onUpdateStatus={handleUpdateReservationStatus}
                    onDelete={handleDeleteReservation}
                  />
                )}

                {activeTab === 'drivers' && (
                  <section className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div><h2 className="text-xl font-bold text-gray-800">Repartidores</h2><p className="text-sm text-gray-600">Usuarios habilitados para recibir hojas de ruta de este restaurante.</p></div>
                      <button onClick={() => setShowDriverForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"><UserPlus className="h-4 w-4" />Nuevo repartidor</button>
                    </div>
                    {drivers.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">No hay repartidores cargados.</div> : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {drivers.map((item) => (
                          <div key={item.driver_id} className="rounded-lg border border-gray-200 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-800">{item.driver.full_name}</p>
                                <p className="truncate text-sm text-gray-500">{item.driver.email}</p>
                                {item.driver.phone && <p className="text-sm text-gray-500">{item.driver.phone}</p>}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{item.is_active ? 'Activo' : 'Inactivo'}</span>
                                <button type="button" onClick={() => setEditingDriver(item)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                  <Edit2 className="h-4 w-4" />
                                  Editar
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeTab === 'waiters' && (
                  <section className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div><h2 className="text-xl font-bold text-gray-800">Mozos</h2><p className="text-sm text-gray-600">Usuarios habilitados para registrar y editar pedidos de mesa desde el movil.</p></div>
                      <button onClick={() => setShowWaiterForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"><UserPlus className="h-4 w-4" />Nuevo mozo</button>
                    </div>
                    {waiters.length === 0 ? <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">No hay mozos cargados.</div> : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {waiters.map((item) => (
                          <div key={item.waiter_id} className="rounded-lg border border-gray-200 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-gray-800">{item.waiter.full_name}</p>
                                <p className="truncate text-sm text-gray-500">{item.waiter.email}</p>
                                {item.waiter.phone && <p className="text-sm text-gray-500">{item.waiter.phone}</p>}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{item.is_active ? 'Activo' : 'Inactivo'}</span>
                                <button type="button" onClick={() => setEditingWaiter(item)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                  <Edit2 className="h-4 w-4" />
                                  Editar
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
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
          categories={dishCategories}
          onClose={() => { setShowMenuForm(false); loadMenuItems(); }}
        />
      )}

      {showOrderForm && selectedRestaurant && (
        <RestaurantOrderForm
          restaurant={selectedRestaurant}
          menuItems={menuItems}
          tables={tables}
          tableOrders={orders}
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
          categories={dishCategories}
          onClose={() => { setEditingItem(null); loadMenuItems(); }}
        />
      )}
      {showDriverForm && selectedRestaurant && (
        <DriverForm restaurantId={selectedRestaurant.id} onClose={() => { setShowDriverForm(false); loadDrivers(); }} />
      )}
      {editingDriver && selectedRestaurant && (
        <DriverForm driver={editingDriver} restaurantId={selectedRestaurant.id} onClose={() => { setEditingDriver(null); loadDrivers(); }} />
      )}
      {showWaiterForm && selectedRestaurant && (
        <WaiterForm restaurantId={selectedRestaurant.id} onClose={() => { setShowWaiterForm(false); loadWaiters(); }} />
      )}
      {editingWaiter && selectedRestaurant && (
        <WaiterForm waiter={editingWaiter} restaurantId={selectedRestaurant.id} onClose={() => { setEditingWaiter(null); loadWaiters(); }} />
      )}
      {closingTableOrder && selectedRestaurant && (
        <TableCloseModal
          restaurantName={selectedRestaurant.name}
          ticket={buildOrderTicket(closingTableOrder)}
          closing={closingTable}
          onClose={() => setClosingTableOrder(null)}
          onConfirm={() => void confirmCloseTableOrder()}
        />
      )}
    </div>
  );
}

function DriverForm({ restaurantId, driver, onClose }: { restaurantId: string; driver?: RestaurantDriver; onClose: () => void }) {
  const isEditing = Boolean(driver);
  const [form, setForm] = useState({
    fullName: driver?.driver.full_name || '',
    email: driver?.driver.email || '',
    phone: driver?.driver.phone || '',
    password: '',
    isActive: driver?.is_active ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: saveError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: isEditing ? 'update-driver' : 'create',
        role: 'driver',
        restaurantId,
        userId: driver?.driver_id,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
        isActive: form.isActive,
      },
    });
    if (saveError || data?.error) {
      setError(data?.error || saveError?.message || 'No se pudo guardar el repartidor');
      setLoading(false);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6">
        <h2 className="text-xl font-bold text-gray-800">{isEditing ? 'Editar repartidor' : 'Nuevo repartidor'}</h2>
        <p className="mb-5 mt-1 text-sm text-gray-500">{isEditing ? 'Actualizá los datos de acceso y disponibilidad.' : 'Se creará un acceso asociado únicamente a este restaurante.'}</p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Nombre completo" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Teléfono" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required={!isEditing} minLength={form.password ? 6 : undefined} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={isEditing ? 'Nueva contraseña (opcional)' : 'Contraseña (mínimo 6 caracteres)'} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          {isEditing && (
            <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
              Repartidor activo para este restaurante
            </label>
          )}
          <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700">Cancelar</button><button disabled={loading} className="flex-1 rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Guardando...' : isEditing ? 'Guardar' : 'Crear'}</button></div>
        </form>
      </div>
    </div>
  );
}

function WaiterForm({ restaurantId, waiter, onClose }: { restaurantId: string; waiter?: RestaurantWaiter; onClose: () => void }) {
  const isEditing = Boolean(waiter);
  const [form, setForm] = useState({
    fullName: waiter?.waiter.full_name || '',
    email: waiter?.waiter.email || '',
    phone: waiter?.waiter.phone || '',
    password: '',
    isActive: waiter?.is_active ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: saveError } = await supabase.functions.invoke('admin-users', {
      body: {
        action: isEditing ? 'update-waiter' : 'create',
        role: 'waiter',
        restaurantId,
        userId: waiter?.waiter_id,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
        isActive: form.isActive,
      },
    });
    if (saveError || data?.error) {
      setError(data?.error || saveError?.message || 'No se pudo guardar el mozo');
      setLoading(false);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6">
        <h2 className="text-xl font-bold text-gray-800">{isEditing ? 'Editar mozo' : 'Nuevo mozo'}</h2>
        <p className="mb-5 mt-1 text-sm text-gray-500">{isEditing ? 'Actualiza los datos de acceso y disponibilidad.' : 'Se creara un acceso asociado unicamente a este restaurante.'}</p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Nombre completo" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Telefono" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          <input required={!isEditing} minLength={form.password ? 6 : undefined} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={isEditing ? 'Nueva contrasena (opcional)' : 'Contrasena (minimo 6 caracteres)'} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          {isEditing && (
            <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
              Mozo activo para este restaurante
            </label>
          )}
          <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700">Cancelar</button><button disabled={loading} className="flex-1 rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Guardando...' : isEditing ? 'Guardar' : 'Crear'}</button></div>
        </form>
      </div>
    </div>
  );
}

function TableSettings({
  tables,
  onCreate,
  onToggle,
  onDelete,
}: {
  tables: RestaurantTable[];
  onCreate: (tableNumber: number, seats: number | null) => void;
  onToggle: (table: RestaurantTable) => void;
  onDelete: (tableId: string) => void;
}) {
  const [tableNumber, setTableNumber] = useState('');
  const [seats, setSeats] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedTableNumber = Number(tableNumber);
    const parsedSeats = seats ? Number(seats) : null;

    if (!Number.isInteger(parsedTableNumber) || parsedTableNumber <= 0) {
      setError('Ingresa un numero de mesa valido.');
      return;
    }
    if (parsedSeats !== null && (!Number.isInteger(parsedSeats) || parsedSeats <= 0)) {
      setError('Ingresa una cantidad de lugares valida.');
      return;
    }
    if (tables.some((table) => table.table_number === parsedTableNumber)) {
      setError('Ya existe una mesa con ese numero.');
      return;
    }

    setError('');
    onCreate(parsedTableNumber, parsedSeats);
    setTableNumber('');
    setSeats('');
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-xl font-bold text-gray-800">Mesas del restaurante</h2>
        <p className="text-sm text-gray-600">Configura las mesas disponibles para registrar pedidos del salon.</p>
      </div>

      <form onSubmit={handleSubmit} className="mb-5 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[160px_160px_auto]">
        <input
          type="number"
          min="1"
          step="1"
          value={tableNumber}
          onChange={(event) => setTableNumber(event.target.value)}
          placeholder="Numero de mesa"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          min="1"
          step="1"
          value={seats}
          onChange={(event) => setSeats(event.target.value)}
          placeholder="Lugares"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
          <Plus className="h-4 w-4" />
          Agregar mesa
        </button>
        {error && <p className="text-sm text-red-700 sm:col-span-3">{error}</p>}
      </form>

      {tables.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">Todavia no hay mesas configuradas.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => (
            <div key={table.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-gray-800">Mesa {table.table_number}</p>
                  <p className="text-sm text-gray-500">{table.seats ? `${table.seats} lugares` : 'Sin lugares definidos'}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${table.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {table.is_active ? 'Disponible' : 'Inactiva'}
                </span>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => onToggle(table)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  {table.is_active ? 'Desactivar' : 'Activar'}
                </button>
                <button type="button" onClick={() => onDelete(table.id)} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function toDateTimeInputValue(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';

  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function ReservationSettings({
  reservations,
  tables,
  editingReservation,
  onEdit,
  onCancelEdit,
  onSave,
  onUpdateStatus,
  onDelete,
}: {
  reservations: RestaurantReservationWithTable[];
  tables: RestaurantTable[];
  editingReservation: RestaurantReservationWithTable | null;
  onEdit: (reservation: RestaurantReservationWithTable) => void;
  onCancelEdit: () => void;
  onSave: (form: ReservationInput, reservationId?: string) => void;
  onUpdateStatus: (reservationId: string, status: ReservationStatus) => void;
  onDelete: (reservationId: string) => void;
}) {
  const activeTables = tables.filter((table) => table.is_active);
  const [form, setForm] = useState<ReservationInput>({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    reservationAt: '',
    partySize: '',
    tableId: '',
    status: 'pending',
    notes: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editingReservation) {
      setForm({
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        reservationAt: '',
        partySize: '',
        tableId: '',
        status: 'pending',
        notes: '',
      });
      setError('');
      return;
    }

    setForm({
      customerName: editingReservation.customer_name,
      customerPhone: editingReservation.customer_phone || '',
      customerEmail: editingReservation.customer_email || '',
      reservationAt: toDateTimeInputValue(editingReservation.reservation_at),
      partySize: editingReservation.party_size?.toString() || '',
      tableId: editingReservation.table_id || '',
      status: editingReservation.status,
      notes: editingReservation.notes || '',
    });
    setError('');
  }, [editingReservation]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedPartySize = form.partySize ? Number(form.partySize) : null;

    if (!form.customerName.trim()) {
      setError('Ingresa el nombre del cliente.');
      return;
    }
    if (!form.reservationAt || Number.isNaN(new Date(form.reservationAt).getTime())) {
      setError('Ingresa una fecha y hora valida.');
      return;
    }
    if (parsedPartySize !== null && (!Number.isInteger(parsedPartySize) || parsedPartySize <= 0)) {
      setError('Ingresa una cantidad de ocupantes valida.');
      return;
    }

    setError('');
    onSave(form, editingReservation?.id);
    if (!editingReservation) {
      setForm({
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        reservationAt: '',
        partySize: '',
        tableId: '',
        status: 'pending',
        notes: '',
      });
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-xl font-bold text-gray-800">Reservas de mesas</h2>
        <p className="text-sm text-gray-600">Registra reservas con cliente, fecha, ocupantes opcionales y mesa asignada.</p>
      </div>

      <form onSubmit={handleSubmit} className="mb-5 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 lg:grid-cols-4">
        <input required value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} placeholder="Cliente" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="datetime-local" required value={form.reservationAt} onChange={(event) => setForm({ ...form, reservationAt: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="number" min="1" step="1" value={form.partySize} onChange={(event) => setForm({ ...form, partySize: event.target.value })} placeholder="Ocupantes (opcional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={form.tableId} onChange={(event) => setForm({ ...form, tableId: event.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Sin mesa asignada</option>
          {activeTables.map((table) => (
            <option key={table.id} value={table.id}>
              Mesa {table.table_number}{table.seats ? ` - ${table.seats} lugares` : ''}
            </option>
          ))}
        </select>
        <input value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} placeholder="Telefono (opcional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="email" value={form.customerEmail} onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} placeholder="Email (opcional)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ReservationStatus })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {Object.entries(reservationStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Notas (opcional)" rows={1} className="rounded-lg border border-gray-300 px-3 py-2 text-sm lg:col-span-4" />
        {error && <p className="text-sm text-red-700 lg:col-span-4">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row lg:col-span-4">
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
            <Plus className="h-4 w-4" />
            {editingReservation ? 'Guardar reserva' : 'Agregar reserva'}
          </button>
          {editingReservation && (
            <button type="button" onClick={onCancelEdit} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white">
              Cancelar edicion
            </button>
          )}
        </div>
      </form>

      {reservations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">Todavia no hay reservas cargadas.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[980px] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Contacto</th>
                <th className="px-3 py-3">Ocupantes</th>
                <th className="px-3 py-3">Mesa</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Notas</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {reservations.map((reservation) => (
                <tr key={reservation.id} className="align-middle hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-3 text-gray-700">{new Date(reservation.reservation_at).toLocaleString()}</td>
                  <td className="px-3 py-3 font-semibold text-gray-800">{reservation.customer_name}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {[reservation.customer_phone, reservation.customer_email].filter(Boolean).join(' - ') || 'Sin contacto'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {reservation.party_size ? `${reservation.party_size} ocupantes` : 'Sin definir'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {reservation.table?.table_number ? `Mesa ${reservation.table.table_number}` : 'Sin mesa'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-xs font-medium ${reservationStatusColors[reservation.status]}`}>
                        {reservationStatusLabels[reservation.status]}
                      </span>
                      <select value={reservation.status} onChange={(event) => onUpdateStatus(reservation.id, event.target.value as ReservationStatus)} className="w-36 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700">
                        {Object.entries(reservationStatusLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="max-w-[220px] px-3 py-3 text-gray-600">
                    {reservation.notes || 'Sin notas'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => onEdit(reservation)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white">
                        <Edit2 className="h-4 w-4" />
                        Editar
                      </button>
                      <button type="button" onClick={() => onDelete(reservation.id)} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RestaurantOrderForm({
  restaurant,
  menuItems,
  tables,
  tableOrders,
  onClose,
  onCreated,
}: {
  restaurant: Restaurant;
  menuItems: MenuItem[];
  tables: RestaurantTable[];
  tableOrders: RestaurantOrder[];
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
  const activeTables = tables.filter((table) => table.is_active);
  const [customer, setCustomer] = useState({ id: '', fullName: '', email: '', phone: '' });
  const [matchedCustomer, setMatchedCustomer] = useState(false);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [customerSearchMessage, setCustomerSearchMessage] = useState('');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const [registeredCustomers, setRegisteredCustomers] = useState<SelectableCustomer[]>([]);
  const [deliveryMethod, setDeliveryMethod] = useState<'delivery' | 'pickup' | 'dine_in'>('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [diningTableId, setDiningTableId] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [createdOrderTicket, setCreatedOrderTicket] = useState<{
    orderId: string;
    customerName: string;
    deliveryAddress: string;
    totalAmount: number;
    items: Array<{ name: string; quantity: number; subtotal: number }>;
  } | null>(null);

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
    if (deliveryMethod === 'dine_in' && !diningTableId) {
      setError('Selecciona una mesa.');
      return;
    }

    const activeTableOrder = deliveryMethod === 'dine_in'
      ? tableOrders.find((order) =>
          order.delivery_method === 'dine_in'
          && order.dining_table_id === diningTableId
          && order.status !== 'closed'
          && order.status !== 'cancelled'
        ) || null
      : null;
    const existingQuantities = new Map<string, number>();
    for (const item of activeTableOrder?.order_items || []) {
      existingQuantities.set(item.menu_item_id, (existingQuantities.get(item.menu_item_id) || 0) + item.quantity);
    }
    for (const item of items) {
      existingQuantities.set(item.menuItemId, (existingQuantities.get(item.menuItemId) || 0) + item.quantity);
    }
    const itemsToSave = activeTableOrder
      ? [...existingQuantities.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      : items;

    let addressToSave = deliveryAddress.trim();
    if (deliveryMethod === 'delivery') {
      const currentLocation = await getCurrentLocation();
      addressToSave = addDefaultLocality(addressToSave, currentLocation?.locality);
    }

    setLoading(true);
    setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-orders', {
      body: activeTableOrder
        ? {
            action: 'updateTableOrder',
            restaurantId: restaurant.id,
            orderId: activeTableOrder.id,
            customerNotes: customerNotes || activeTableOrder.customer_notes || '',
            items: itemsToSave,
          }
        : {
            restaurantId: restaurant.id,
            customer,
            deliveryMethod,
            diningTableId: deliveryMethod === 'dine_in' ? diningTableId : null,
            deliveryAddress: addressToSave,
            latitude: null,
            longitude: null,
            customerNotes,
            items: itemsToSave,
          },
    });
    setLoading(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'No se pudo crear el pedido.');
      return;
    }

    setCreatedOrderTicket({
      orderId: data.orderId,
      customerName: customer.fullName.trim() || (deliveryMethod === 'dine_in' ? 'Pedido de mesa' : 'Cliente ocasional'),
      deliveryAddress: deliveryMethod === 'delivery'
        ? addressToSave
        : deliveryMethod === 'dine_in'
          ? `Mesa ${tables.find((table) => table.id === diningTableId)?.table_number || ''}`
          : restaurant.address || 'Retira en el restaurante',
      totalAmount: activeTableOrder ? Number(data.totalAmount || total) : total,
      items: items.map((item) => ({
        name: availableItems.find((menuItem) => menuItem.id === item.menuItemId)?.name || 'Producto',
        quantity: item.quantity,
        subtotal: (availableItems.find((menuItem) => menuItem.id === item.menuItemId)?.price || 0) * item.quantity,
      })),
    });
    setShowSuccessMessage(true);
  }

  function printOrderTicket() {
    if (!createdOrderTicket) return;

    if (!openOrderTicket(restaurant.name, createdOrderTicket)) {
      setError('El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes e intentá nuevamente.');
      setShowSuccessMessage(false);
      return;
    }

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
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:col-span-2">
              <button type="button" onClick={openCustomerModal} disabled={searchingCustomer} className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-orange-500 px-4 py-2 font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50">
                <Search className="h-4 w-4" />
                {searchingCustomer ? 'Cargando clientes...' : 'Buscar cliente registrado'}
              </button>
              <input required={deliveryMethod !== 'dine_in'} type="text" placeholder={deliveryMethod === 'dine_in' ? 'Nombre opcional' : 'Nombre y apellido'} value={customer.fullName} readOnly={matchedCustomer} onChange={(e) => setCustomer({ ...customer, fullName: e.target.value })} className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-orange-500 read-only:bg-gray-100" />
              {matchedCustomer && <button type="button" onClick={clearSelectedCustomer} className="col-span-2 justify-self-start rounded-lg border border-gray-300 px-4 py-2 text-gray-600 hover:bg-gray-50">Quitar seleccion</button>}
            </div>
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
            <h3 className="font-semibold text-gray-800 sm:col-span-2">Tipo de pedido</h3>
            <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as 'delivery' | 'pickup' | 'dine_in')} className="rounded-lg border border-gray-300 px-3 py-2">
              <option value="delivery">Entrega a domicilio</option>
              <option value="pickup">Retira en el restaurante</option>
              <option value="dine_in">Mesa en el local</option>
            </select>
            {deliveryMethod === 'delivery' ? (
              <input required type="text" placeholder="Direccion de entrega" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2" />
            ) : deliveryMethod === 'dine_in' ? (
              <select required value={diningTableId} onChange={(e) => setDiningTableId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2">
                <option value="">Seleccionar mesa</option>
                {activeTables.map((table) => (
                  <option key={table.id} value={table.id}>
                    Mesa {table.table_number}{table.seats ? ` - ${table.seats} lugares` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{restaurant.address || 'Retira en el restaurante'}</div>
            )}
            {deliveryMethod === 'dine_in' && activeTables.length === 0 && (
              <p className="text-sm text-red-700 sm:col-span-2">No hay mesas activas. Configuralas desde la seccion Mesas.</p>
            )}
            <textarea placeholder="Notas del pedido" rows={2} value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2" />
          </section>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-lg font-bold text-gray-800">Total: {moneyFormatter.format(total)}</p>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={loading || geoLoading || availableItems.length === 0 || (deliveryMethod === 'dine_in' && activeTables.length === 0)} className="rounded-lg bg-orange-500 px-4 py-2 font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
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

      {showSuccessMessage && createdOrderTicket && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="created-order-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h2 id="created-order-title" className="text-lg font-bold text-gray-800">Pedido creado correctamente</h2>
                <p className="mt-1 text-sm text-gray-600">Pedido #{createdOrderTicket.orderId.slice(0, 8)}. Podés imprimir el ticket para adjuntarlo al pedido.</p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onCreated} className="rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-50">
                Finalizar
              </button>
              <button type="button" onClick={printOrderTicket} autoFocus className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-5 py-2 font-semibold text-white hover:bg-orange-600">
                <Printer className="h-4 w-4" />
                Imprimir ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItemForm({ restaurantId, categories, onClose }: { restaurantId: string; categories: DishCategory[]; onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    categoryId: categories[0]?.id || '',
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
        category_id: formData.categoryId,
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
            <select
              required
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            >
              <option value="" disabled>Selecciona una categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {categories.length === 0 && <p className="mt-2 text-sm text-red-600">No hay categorias activas. Solicita al administrador que cree una.</p>}
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
              disabled={loading || categories.length === 0}
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

function MenuItemEditForm({ item, categories, onClose }: { item: MenuItem; categories: DishCategory[]; onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: item.name,
    description: item.description || '',
    price: item.price.toString(),
    categoryId: item.category_id || '',
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
          category_id: formData.categoryId,
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
            <select
              required
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            >
              {!categories.some((category) => category.id === item.category_id) && item.category && (
                <option value={item.category_id}>{item.category} (inactiva)</option>
              )}
              <option value="" disabled>Selecciona una categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
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
              disabled={loading || !formData.categoryId}
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
