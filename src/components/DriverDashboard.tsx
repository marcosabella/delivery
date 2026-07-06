import { useCallback, useEffect, useState } from 'react';
import { Bike, CheckCircle2, ClipboardList, Clock, LocateFixed, LogOut, MapPin, Navigation, PackageCheck, Play, Store } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { notifyCustomerOrderStatus } from '../lib/orderStatusNotifications';
import { Order, supabase } from '../lib/supabase';

type RouteOrder = {
  id: string;
  stop_sequence: number;
  status: 'pending' | 'delivered' | 'failed';
  delivered_at: string | null;
  delivery_notes: string | null;
  order: Order & {
    customer?: { full_name: string | null; phone: string | null } | null;
    order_items?: Array<{ id: string; quantity: number; menu_item?: { name: string | null } | null }>;
  };
};

type DriverRoute = {
  id: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  restaurant: { name: string; address: string | null; phone: string | null };
  delivery_route_orders: RouteOrder[];
};

const routeStatusLabels = {
  assigned: 'Asignada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

type RouteView = 'assigned' | 'completed';

export function DriverDashboard() {
  const { profile, signOut } = useAuth();
  const { getCurrentLocation, location, error: geoError, loading: geoLoading } = useGeolocation();
  const [routes, setRoutes] = useState<DriverRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [routeView, setRouteView] = useState<RouteView>('assigned');

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('delivery_routes')
      .select(`
        id, status, assigned_at, started_at, completed_at,
        restaurant:restaurants!delivery_routes_restaurant_id_fkey (name, address, phone),
        delivery_route_orders (
          id, stop_sequence, status, delivered_at, delivery_notes,
          order:orders!delivery_route_orders_order_id_fkey (
            *, customer:profiles!orders_customer_id_fkey (full_name, phone),
            order_items (id, quantity, menu_item:menu_items (name))
          )
        )
      `)
      .eq('driver_id', profile!.id)
      .order('created_at', { ascending: false });

    if (loadError) setError(loadError.message);
    else setRoutes((data || []) as unknown as DriverRoute[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    void loadRoutes();
    void getCurrentLocation();
  }, [getCurrentLocation, loadRoutes]);

  async function startRoute(routeId: string) {
    setBusyId(routeId);
    setError('');
    const { error: startError } = await supabase.rpc('start_delivery_route', { target_route_id: routeId });
    if (startError) setError(startError.message);
    await loadRoutes();
    setBusyId(null);
  }

  async function completeDelivery(routeOrderId: string) {
    const notes = window.prompt('Nota de entrega (opcional):') ?? '';
    const routeOrder = routes
      .flatMap((route) => route.delivery_route_orders)
      .find((currentRouteOrder) => currentRouteOrder.id === routeOrderId);
    setBusyId(routeOrderId);
    setError('');
    const { error: completeError } = await supabase.rpc('complete_route_order', {
      target_route_order_id: routeOrderId,
      target_notes: notes,
    });
    if (completeError) setError(completeError.message);
    else if (routeOrder) void notifyCustomerOrderStatus(routeOrder.order.id);
    await loadRoutes();
    setBusyId(null);
  }

  function customerName(routeOrder: RouteOrder) {
    return routeOrder.order.customer?.full_name || routeOrder.order.guest_customer_name || 'Cliente';
  }

  function hasValidCoordinates(order: Order) {
    return typeof order.latitude === 'number'
      && typeof order.longitude === 'number'
      && Number.isFinite(order.latitude)
      && Number.isFinite(order.longitude)
      && order.latitude >= -90
      && order.latitude <= 90
      && order.longitude >= -180
      && order.longitude <= 180
      && (order.latitude !== 0 || order.longitude !== 0);
  }

  function orderDestination(order: Order) {
    return hasValidCoordinates(order)
      ? `${order.latitude},${order.longitude}`
      : order.delivery_address;
  }

  function mapUrl(order: Order) {
    const destination = orderDestination(order);
    if (!location) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
    }

    const origin = `${location.latitude},${location.longitude}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving&dir_action=navigate`;
  }

  function routeMapUrl(stops: RouteOrder[]) {
    const pendingStops = stops.filter((stop) => stop.status === 'pending');
    if (!location || pendingStops.length === 0) return null;

    const origin = `${location.latitude},${location.longitude}`;
    const destination = orderDestination(pendingStops[pendingStops.length - 1].order);
    const waypoints = pendingStops
      .slice(0, -1)
      .map((stop) => orderDestination(stop.order))
      .join('|');
    const waypointParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';

    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointParam}&travelmode=driving&dir_action=navigate`;
  }

  const assignedRoutes = routes.filter((route) => route.status === 'assigned' || route.status === 'in_progress');
  const completedRoutes = routes.filter((route) => route.status === 'completed');
  const visibleRoutes = routeView === 'assigned' ? assignedRoutes : completedRoutes;

  const menuItems: Array<{ id: RouteView; label: string; count: number }> = [
    { id: 'assigned', label: 'Hoja de ruta asignada', count: assignedRoutes.length },
    { id: 'completed', label: 'Hoja de ruta completada', count: completedRoutes.length },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-600 p-2 text-white"><Bike className="h-5 w-5" /></div>
            <div><h1 className="font-semibold text-slate-900">Panel repartidor</h1><p className="text-xs text-slate-500">{profile?.full_name}</p></div>
          </div>
          <button onClick={() => signOut()} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <aside className="border-b border-slate-200 bg-white p-3 md:min-h-[calc(100vh-65px)] md:w-64 md:shrink-0 md:border-b-0 md:border-r md:p-4">
          <p className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:block">Hojas de ruta</p>
          <nav className="grid grid-cols-2 gap-2 md:grid-cols-1" aria-label="Hojas de ruta">
            {menuItems.map((item) => {
              const active = routeView === item.id;
              const Icon = item.id === 'completed' ? CheckCircle2 : ClipboardList;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRouteView(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${active ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 leading-tight">{item.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>{item.count}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 space-y-4 px-4 py-5 md:px-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{routeView === 'assigned' ? 'Hoja de ruta asignada' : 'Hoja de ruta completada'}</h2>
            <p className="mt-1 text-sm text-slate-500">{routeView === 'assigned' ? 'Recorridos pendientes y en curso.' : 'Historial de recorridos finalizados.'}</p>
          </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {routeView === 'assigned' && <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${geoError ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-cyan-200 bg-cyan-50 text-cyan-900'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <LocateFixed className={`h-5 w-5 shrink-0 ${geoLoading ? 'animate-pulse' : ''}`} />
            <div className="min-w-0">
              <p className="font-semibold">{geoLoading ? 'Localizando posicion de inicio...' : location ? 'Posicion de inicio detectada' : 'Ubicacion no disponible'}</p>
              <p className="truncate text-xs opacity-80">{geoError || (location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : 'Se necesita la ubicacion para calcular la ruta.')}</p>
            </div>
          </div>
          {!geoLoading && !location && <button type="button" onClick={() => void getCurrentLocation()} className="shrink-0 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold hover:bg-white/50">Reintentar</button>}
        </div>}
        {loading ? (
          <div className="py-16 text-center text-slate-500">Cargando hojas de ruta...</div>
        ) : visibleRoutes.length === 0 ? (
          <div className="rounded-xl bg-white p-10 text-center shadow-sm"><Clock className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-medium text-slate-700">{routeView === 'assigned' ? 'No tenés hojas de ruta asignadas' : 'No tenés hojas de ruta completadas'}</p></div>
        ) : visibleRoutes.map((route) => {
          const stops = [...route.delivery_route_orders].sort((a, b) => a.stop_sequence - b.stop_sequence);
          const delivered = stops.filter((stop) => stop.status === 'delivered').length;
          const fullRouteUrl = routeMapUrl(stops);
          return (
            <section key={route.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><Store className="h-4 w-4 text-cyan-600" /><h2 className="font-semibold text-slate-900">{route.restaurant.name}</h2></div><p className="mt-1 text-sm text-slate-500">Ruta #{route.id.slice(0, 8)} · {new Date(route.assigned_at).toLocaleString()}</p></div>
                  <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800">{routeStatusLabels[route.status]}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-600"><span>{delivered} de {stops.length} entregados</span><span>{stops.length ? Math.round((delivered / stops.length) * 100) : 0}%</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-cyan-600 transition-all" style={{ width: `${stops.length ? (delivered / stops.length) * 100 : 0}%` }} /></div>
                {fullRouteUrl && route.status !== 'completed' && <a href={fullRouteUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-600 px-4 py-2.5 font-semibold text-cyan-700 hover:bg-cyan-50"><Navigation className="h-4 w-4" />Navegar recorrido completo</a>}
                {route.status === 'assigned' && <button onClick={() => startRoute(route.id)} disabled={busyId === route.id} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"><Play className="h-4 w-4" />Iniciar recorrido</button>}
              </div>
              <ol className="divide-y divide-slate-100">
                {stops.map((stop) => (
                  <li key={stop.id} className="p-4">
                    <div className="flex gap-3">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${stop.status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-cyan-100 text-cyan-800'}`}>{stop.status === 'delivered' ? <CheckCircle2 className="h-5 w-5" /> : stop.stop_sequence}</div>
                      <div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{customerName(stop)}</p><p className="mt-1 flex items-start gap-1 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{stop.order.delivery_address}</p>{stop.order.customer?.phone && <p className="mt-1 text-sm text-slate-500">Tel: {stop.order.customer.phone}</p>}<div className="mt-2 text-xs text-slate-500">{stop.order.order_items?.map((item) => `${item.quantity}x ${item.menu_item?.name || 'Producto'}`).join(' · ')}</div>{stop.delivered_at && <p className="mt-2 text-xs font-medium text-green-700">Entregado el {new Date(stop.delivered_at).toLocaleString()}</p>}</div>
                    </div>
                    {stop.status === 'pending' && route.status !== 'completed' && <div className="mt-3 grid grid-cols-2 gap-2"><a href={mapUrl(stop.order)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Navigation className="h-4 w-4" />Navegar</a><button onClick={() => completeDelivery(stop.id)} disabled={busyId === stop.id} className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"><PackageCheck className="h-4 w-4" />Entregado</button></div>}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
        </main>
      </div>
    </div>
  );
}
