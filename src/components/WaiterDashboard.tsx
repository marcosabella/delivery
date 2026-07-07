import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList, LogOut, Minus, Plus, Search, Store, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { MenuItem, Order, Restaurant, RestaurantTable, supabase } from '../lib/supabase';
import { TableCloseModal } from './TableCloseModal';

type TableOrder = Order & {
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
};

type WaiterAssignment = {
  restaurant_id: string;
  is_active: boolean;
  restaurant?: Restaurant;
};

type RestaurantPromotionItem = {
  id: string;
  menu_item_id: string;
  quantity: number;
  menu_item?: Pick<MenuItem, 'id' | 'name' | 'price' | 'category'> | null;
};

type RestaurantPromotion = {
  id: string;
  restaurant_id: string;
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

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

const activeOrderStatuses: Order['status'][] = ['pending', 'confirmed', 'preparing', 'delivered'];

const statusLabels: Record<Order['status'], string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  delivering: 'En camino',
  delivered: 'Entregado',
  closed: 'Mesa cerrada',
  cancelled: 'Cancelado',
};

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

export function WaiterDashboard() {
  const { profile, signOut } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [promotions, setPromotions] = useState<RestaurantPromotion[]>([]);
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [menuSearch, setMenuSearch] = useState('');
  const [showMenuSearch, setShowMenuSearch] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (profile) void loadRestaurants();
  }, [profile]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    void Promise.all([loadTables(), loadMenuItems(), loadPromotions(), loadOrders()]);
  }, [selectedRestaurant]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    const channel = supabase
      .channel(`waiter-orders-${selectedRestaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${selectedRestaurant.id}` }, () => void loadOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => void loadOrders())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedRestaurant]);

  const selectedTable = tables.find((table) => table.id === selectedTableId) || null;
  const selectedOrder = selectedTableId ? getActiveOrderForTable(selectedTableId) : null;
  const availableItems = menuItems.filter((item) => item.is_available);
  const activePromotions = promotions.filter(isPromotionCurrent);
  const comboPromotions = activePromotions.filter((promotion) => promotion.promotion_type === 'combo');
  const discountPromotions = activePromotions.filter((promotion) => promotion.promotion_type === 'discount');
  const selectedPromotions = comboPromotions.filter((promotion) => (quantities[`promotion:${promotion.id}`] || 0) > 0);
  const total = availableItems.reduce((sum, item) => sum + getItemOrderPrice(item) * (quantities[item.id] || 0), 0)
    + selectedPromotions.reduce((sum, promotion) => sum + getPromotionOrderPrice(promotion) * (quantities[`promotion:${promotion.id}`] || 0), 0);
  const selectedItemsCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const selectedMenuItems = availableItems.filter((item) => (quantities[item.id] || 0) > 0);
  const normalizedMenuSearch = menuSearch.trim().toLowerCase();
  const visibleMenuItems = normalizedMenuSearch
    ? availableItems.filter((item) => {
        const searchableText = `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase();
        return searchableText.includes(normalizedMenuSearch);
      })
    : availableItems;
  const visibleComboPromotions = normalizedMenuSearch
    ? comboPromotions.filter((promotion) => {
        const comboItems = (promotion.items || []).map((item) => item.menu_item?.name || '').join(' ');
        const searchableText = `${promotion.name} ${promotion.description || ''} ${comboItems}`.toLowerCase();
        return searchableText.includes(normalizedMenuSearch);
      })
    : comboPromotions;

  const menuGroups = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of visibleMenuItems) {
      const category = item.category || 'Sin categoria';
      groups.set(category, [...(groups.get(category) || []), item]);
    }
    return [...groups.entries()];
  }, [visibleMenuItems]);

  function getItemDiscountPromotion(itemId: string) {
    return discountPromotions.find((promotion) =>
      (promotion.items || []).some((item) => item.menu_item_id === itemId)
    ) || null;
  }

  function getItemOrderPrice(item: MenuItem) {
    const promotion = getItemDiscountPromotion(item.id);
    return promotion ? getDiscountedPrice(item.price, promotion) : item.price;
  }

  function getComboBaseTotal(promotion: RestaurantPromotion) {
    return (promotion.items || []).reduce(
      (sum, item) => sum + Number(item.menu_item?.price || 0) * item.quantity,
      0,
    );
  }

  function getPromotionOrderPrice(promotion: RestaurantPromotion) {
    return promotion.discount_type === 'fixed_price'
      ? Number(promotion.discount_value)
      : getDiscountedPrice(getComboBaseTotal(promotion), promotion);
  }

  async function loadRestaurants() {
    if (!profile) return;
    setLoading(true);
    setError('');

    const { data, error: assignmentsError } = await supabase
      .from('restaurant_waiters')
      .select('restaurant_id, is_active, restaurant:restaurants (*)')
      .eq('waiter_id', profile.id)
      .eq('is_active', true);

    if (assignmentsError) {
      setError(assignmentsError.message);
      setLoading(false);
      return;
    }

    const assignedRestaurants = ((data || []) as unknown as WaiterAssignment[])
      .map((assignment) => assignment.restaurant)
      .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));

    setRestaurants(assignedRestaurants);
    setSelectedRestaurant((current) => current && assignedRestaurants.some((restaurant) => restaurant.id === current.id)
      ? current
      : assignedRestaurants[0] || null);
    setLoading(false);
  }

  async function loadTables() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.id)
      .eq('is_active', true)
      .order('table_number', { ascending: true });

    setTables((data || []) as RestaurantTable[]);
  }

  async function loadMenuItems() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('restaurant_id', selectedRestaurant.id)
      .eq('is_available', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    setMenuItems((data || []) as MenuItem[]);
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
      .order('created_at', { ascending: false });

    setPromotions((data || []) as unknown as RestaurantPromotion[]);
  }

  async function loadOrders() {
    if (!selectedRestaurant) return;
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          menu_item_id,
          quantity,
          unit_price,
          subtotal,
          menu_item:menu_items (name, category)
        )
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .eq('delivery_method', 'dine_in')
      .in('status', activeOrderStatuses)
      .order('created_at', { ascending: false });

    setOrders((data || []) as TableOrder[]);
  }

  function getActiveOrderForTable(tableId: string) {
    return orders.find((order) => order.dining_table_id === tableId) || null;
  }

  function openTable(table: RestaurantTable) {
    const activeOrder = getActiveOrderForTable(table.id);
    const nextQuantities: Record<string, number> = {};
    for (const item of activeOrder?.order_items || []) {
      nextQuantities[item.menu_item_id] = item.quantity;
    }

    setSelectedTableId(table.id);
    setQuantities(nextQuantities);
    setMenuSearch('');
    setShowMenuSearch(false);
    setNotes(activeOrder?.customer_notes || '');
    setError('');
    setSuccess('');
  }

  function setQuantity(itemId: string, nextQuantity: number) {
    setQuantities((current) => {
      const quantity = Math.max(0, Math.floor(nextQuantity || 0));
      const next = { ...current };
      if (quantity === 0) delete next[itemId];
      else next[itemId] = quantity;
      return next;
    });
  }

  function selectMenuQuantity(itemId: string, nextQuantity: number) {
    setQuantity(itemId, nextQuantity);
  }

  async function handleSaveOrder() {
    if (!selectedRestaurant || !selectedTable) return;
    if (selectedOrder?.status === 'closed' || selectedOrder?.status === 'cancelled') {
      setError('La mesa ya esta cerrada.');
      return;
    }

    const items = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([itemId, quantity]) => itemId.startsWith('promotion:')
        ? { promotionId: itemId.replace('promotion:', ''), quantity }
        : { menuItemId: itemId, quantity });

    if (items.length === 0) {
      setError('Selecciona al menos un producto.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-orders', {
      body: selectedOrder
        ? {
            action: 'updateTableOrder',
            restaurantId: selectedRestaurant.id,
            orderId: selectedOrder.id,
            customerNotes: notes,
            items,
          }
        : {
            restaurantId: selectedRestaurant.id,
            customer: { id: '', fullName: '', email: '', phone: '' },
            deliveryMethod: 'dine_in',
            diningTableId: selectedTable.id,
            deliveryAddress: '',
            latitude: null,
            longitude: null,
            customerNotes: notes,
            items,
          },
    });
    setSaving(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'No se pudo guardar el pedido.');
      return;
    }

    await loadOrders();
    setSelectedTableId(null);
    setQuantities({});
    setNotes('');
    setMenuSearch('');
    setShowMenuSearch(false);
    setSuccess(selectedOrder ? 'Pedido actualizado.' : 'Pedido registrado.');
  }

  function getCloseTicket() {
    if (!selectedOrder || !selectedTable) return null;
    return {
      orderId: selectedOrder.id,
      customerName: `Mesa ${selectedTable.table_number}`,
      deliveryAddress: `Mesa ${selectedTable.table_number}${selectedTable.label ? ` - ${selectedTable.label}` : ''}`,
      tableLabel: `Mesa ${selectedTable.table_number}${selectedTable.label ? ` - ${selectedTable.label}` : ''}`,
      waiterName: profile?.full_name || profile?.email || 'Mozo',
      totalAmount: selectedOrder.total_amount,
      notes: selectedOrder.customer_notes,
      items: (selectedOrder.order_items || []).map((item) => ({
        name: item.menu_item?.name || 'Producto',
        quantity: item.quantity,
        subtotal: item.subtotal,
      })),
    };
  }

  async function handleCloseTable() {
    if (!selectedRestaurant || !selectedOrder || selectedOrder.status !== 'delivered') return;

    setClosing(true);
    setError('');
    setSuccess('');
    const { data, error: invokeError } = await supabase.functions.invoke('restaurant-orders', {
      body: {
        action: 'closeTableOrder',
        restaurantId: selectedRestaurant.id,
        orderId: selectedOrder.id,
      },
    });
    setClosing(false);

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'No se pudo cerrar la mesa.');
      return;
    }

    setShowCloseModal(false);
    setSelectedTableId(null);
    setQuantities({});
    setNotes('');
    setSuccess('Mesa cerrada.');
    await loadOrders();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-orange-500" />
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="min-h-screen bg-slate-100 p-4">
        <div className="mx-auto max-w-md rounded-lg bg-white p-5 shadow-sm">
          <Store className="mb-3 h-8 w-8 text-orange-500" />
          <h1 className="text-lg font-semibold text-slate-900">Sin restaurante asignado</h1>
          <p className="mt-1 text-sm text-slate-600">Solicita al restaurante que active tu usuario de mozo.</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button onClick={() => signOut()} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            <LogOut className="h-4 w-4" />
            Salir
          </button>
        </div>
      </div>
    );
  }

  if (selectedTable && showMenuSearch) {
    return (
      <div className="min-h-screen bg-slate-100">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex min-h-14 items-center justify-between gap-3 px-3">
            <button type="button" onClick={() => setShowMenuSearch(false)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Volver a la mesa">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold text-slate-900">Buscar en la carta</p>
              <p className="truncate text-xs text-slate-500">Mesa {selectedTable.table_number}</p>
            </div>
            <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-3 pb-24 pt-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <label htmlFor="waiter-menu-search" className="mb-2 block text-sm font-semibold text-slate-800">
              Producto, categoria o descripcion
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 focus-within:border-orange-500">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                id="waiter-menu-search"
                type="search"
                value={menuSearch}
                onChange={(event) => setMenuSearch(event.target.value)}
                placeholder="Escribir producto, categoria o descripcion"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
              />
            </div>
          </section>

          {availableItems.length === 0 && comboPromotions.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white py-8 text-center text-sm text-slate-500">
              No hay opciones disponibles en la carta.
            </div>
          ) : menuGroups.length === 0 && visibleComboPromotions.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white py-8 text-center text-sm text-slate-500">
              No se encontraron productos para esa busqueda.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleComboPromotions.length > 0 && (
                <section className="rounded-lg border border-orange-200 bg-white p-3">
                  <h2 className="mb-2 text-sm font-semibold text-slate-800">Promociones</h2>
                  <div className="space-y-2">
                    {visibleComboPromotions.map((promotion) => {
                      const key = `promotion:${promotion.id}`;
                      const quantity = quantities[key] || 0;
                      const comboItems = (promotion.items || []).map((item) => `${item.quantity}x ${item.menu_item?.name || 'Producto'}`).join(', ');
                      return (
                        <div key={promotion.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-orange-50 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{promotion.name}</p>
                            <p className="mt-1 text-sm font-medium text-orange-600">{moneyFormatter.format(getPromotionOrderPrice(promotion))}</p>
                            {comboItems && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{comboItems}</p>}
                          </div>
                          <div className="grid grid-cols-[36px_44px_36px] items-center rounded-lg border border-orange-200 bg-white">
                            <button type="button" onClick={() => selectMenuQuantity(key, quantity - 1)} className="flex h-10 items-center justify-center text-slate-600" aria-label={`Quitar ${promotion.name}`}>
                              <Minus className="h-4 w-4" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={quantity}
                              onChange={(event) => selectMenuQuantity(key, Number(event.target.value))}
                              className="h-10 w-11 border-x border-orange-100 bg-white text-center text-sm font-bold text-slate-900 outline-none"
                              aria-label={`Cantidad de ${promotion.name}`}
                            />
                            <button type="button" onClick={() => selectMenuQuantity(key, quantity + 1)} className="flex h-10 items-center justify-center text-orange-600" aria-label={`Agregar ${promotion.name}`}>
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              {menuGroups.map(([category, items]) => (
                <section key={category} className="rounded-lg border border-slate-200 bg-white p-3">
                  <h2 className="mb-2 text-sm font-semibold text-slate-800">{category}</h2>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const quantity = quantities[item.id] || 0;
                      return (
                        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-slate-50 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                            {item.description && <p className="line-clamp-2 text-xs text-slate-500">{item.description}</p>}
                            <p className="mt-1 text-sm font-medium text-orange-600">
                              {moneyFormatter.format(getItemOrderPrice(item))}
                              {getItemDiscountPromotion(item.id) && <span className="ml-1 text-xs font-semibold">promo</span>}
                            </p>
                          </div>
                          <div className="grid grid-cols-[36px_44px_36px] items-center rounded-lg border border-slate-200 bg-white">
                            <button type="button" onClick={() => selectMenuQuantity(item.id, quantity - 1)} className="flex h-10 items-center justify-center text-slate-600" aria-label={`Quitar ${item.name}`}>
                              <Minus className="h-4 w-4" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              value={quantity}
                              onChange={(event) => selectMenuQuantity(item.id, Number(event.target.value))}
                              className="h-10 w-11 border-x border-slate-200 bg-white text-center text-sm font-bold text-slate-900 outline-none"
                              aria-label={`Cantidad de ${item.name}`}
                            />
                            <button type="button" onClick={() => selectMenuQuantity(item.id, quantity + 1)} className="flex h-10 items-center justify-center text-orange-600" aria-label={`Agregar ${item.name}`}>
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">{selectedItemsCount} items</p>
              <p className="text-lg font-bold text-slate-900">{moneyFormatter.format(total)}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowMenuSearch(false)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Mesa
            </button>
          </div>
        </footer>
      </div>
    );
  }

  if (selectedTable) {
    const closeTicket = getCloseTicket();

    return (
      <div className="min-h-screen bg-slate-100">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex min-h-14 items-center justify-between gap-3 px-3">
            <button type="button" onClick={() => setSelectedTableId(null)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Volver a mesas">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold text-slate-900">Mesa {selectedTable.table_number}</p>
              <p className="truncate text-xs text-slate-500">{selectedRestaurant.name}</p>
            </div>
            <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-3 pb-28 pt-4">
          {selectedOrder && (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Editando pedido #{selectedOrder.id.slice(0, 8)} - {statusLabels[selectedOrder.status]}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowMenuSearch(true)}
            className="mb-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            <Search className="h-4 w-4" />
            Buscar opciones de carta
          </button>

          <section className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800">Pedido de la mesa</h2>
                <p className="text-xs text-slate-500">Solo se muestran los productos seleccionados.</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                {selectedItemsCount}
              </span>
            </div>

            {selectedMenuItems.length === 0 && selectedPromotions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
                Todavia no seleccionaste productos para esta mesa.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedPromotions.map((promotion) => {
                  const key = `promotion:${promotion.id}`;
                  const quantity = quantities[key] || 0;
                  return (
                    <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-orange-50 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{promotion.name}</p>
                        <p className="mt-1 text-sm font-medium text-orange-600">{moneyFormatter.format(getPromotionOrderPrice(promotion))} combo</p>
                      </div>
                      <div className="grid grid-cols-[36px_44px_36px] items-center rounded-lg border border-orange-200 bg-white">
                        <button type="button" onClick={() => setQuantity(key, quantity - 1)} className="flex h-10 items-center justify-center text-slate-600" aria-label={`Quitar ${promotion.name}`}>
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center text-sm font-bold text-slate-900">{quantity}</span>
                        <button type="button" onClick={() => setQuantity(key, quantity + 1)} className="flex h-10 items-center justify-center text-orange-600" aria-label={`Agregar ${promotion.name}`}>
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {selectedMenuItems.map((item) => {
                  const quantity = quantities[item.id] || 0;
                  return (
                    <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-slate-50 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="mt-1 text-sm font-medium text-orange-600">
                          {moneyFormatter.format(getItemOrderPrice(item))}
                          {getItemDiscountPromotion(item.id) && <span className="ml-1 text-xs font-semibold">promo</span>}
                        </p>
                      </div>
                      <div className="grid grid-cols-[36px_44px_36px] items-center rounded-lg border border-slate-200 bg-white">
                        <button type="button" onClick={() => setQuantity(item.id, quantity - 1)} className="flex h-10 items-center justify-center text-slate-600" aria-label={`Quitar ${item.name}`}>
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-center text-sm font-bold text-slate-900">{quantity}</span>
                        <button type="button" onClick={() => setQuantity(item.id, quantity + 1)} className="flex h-10 items-center justify-center text-orange-600" aria-label={`Agregar ${item.name}`}>
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notas para cocina"
            rows={3}
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          />
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">{selectedItemsCount} items</p>
              <p className="text-lg font-bold text-slate-900">{moneyFormatter.format(total)}</p>
            </div>
            <button
              type="button"
              onClick={handleSaveOrder}
              disabled={saving || (availableItems.length === 0 && comboPromotions.length === 0)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {saving ? 'Guardando...' : selectedOrder ? 'Guardar' : 'Registrar'}
            </button>
            {selectedOrder?.status === 'delivered' && (
              <button
                type="button"
                onClick={() => setShowCloseModal(true)}
                disabled={closing}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {closing ? 'Cerrando...' : 'Cerrar mesa'}
              </button>
            )}
          </div>
        </footer>

        {showCloseModal && closeTicket && (
          <TableCloseModal
            restaurantName={selectedRestaurant.name}
            ticket={closeTicket}
            closing={closing}
            onClose={() => setShowCloseModal(false)}
            onConfirm={() => void handleCloseTable()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="flex min-h-14 items-center justify-between gap-3 px-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">Panel mozo</p>
            <p className="truncate text-xs text-slate-500">{selectedRestaurant.name}</p>
          </div>
          <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-3 py-4">
        {restaurants.length > 1 && (
          <select
            value={selectedRestaurant.id}
            onChange={(event) => {
              const restaurant = restaurants.find((item) => item.id === event.target.value);
              if (restaurant) setSelectedRestaurant(restaurant);
            }}
            className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>
            ))}
          </select>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <UtensilsCrossed className="mb-2 h-5 w-5 text-orange-500" />
            <p className="text-2xl font-bold text-slate-900">{tables.length}</p>
            <p className="text-xs text-slate-500">Mesas activas</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <ClipboardList className="mb-2 h-5 w-5 text-blue-500" />
            <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
            <p className="text-xs text-slate-500">Pedidos abiertos</p>
          </div>
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {success && <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

        {tables.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-500">
            No hay mesas activas para tomar pedidos.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tables.map((table) => {
              const tableOrder = getActiveOrderForTable(table.id);
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => openTable(table)}
                  className={`min-h-32 rounded-lg border p-4 text-left shadow-sm transition ${
                    tableOrder
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-slate-200 bg-white hover:border-orange-200'
                  }`}
                >
                  <span className="block text-2xl font-bold text-slate-900">Mesa {table.table_number}</span>
                  <span className="mt-1 block text-xs text-slate-500">{table.seats ? `${table.seats} lugares` : 'Sin lugares'}</span>
                  <span className={`mt-4 inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                    tableOrder ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-700'
                  }`}>
                    {tableOrder ? `Pedido #${tableOrder.id.slice(0, 8)}` : 'Libre'}
                  </span>
                  {tableOrder && <span className="mt-2 block text-sm font-semibold text-slate-800">{moneyFormatter.format(tableOrder.total_amount)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
