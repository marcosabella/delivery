import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, Restaurant, MenuItem, Order } from '../lib/supabase';
import { LogOut, Plus, Store, UtensilsCrossed, Trash2, Clock, CreditCard as Edit2, Image as ImageIcon } from 'lucide-react';

export function RestaurantDashboard() {
  const { profile, signOut } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showMenuForm, setShowMenuForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'menu' | 'orders'>('menu');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (profile) {
      loadRestaurants();
    }
  }, [profile]);

  useEffect(() => {
    if (selectedRestaurant) {
      loadMenuItems();
      loadOrders();
    }
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
        customer:profiles!customer_id (full_name, email, phone)
      `)
      .eq('restaurant_id', selectedRestaurant.id)
      .order('created_at', { ascending: false });

    if (data) setOrders(data as any);
  }

  async function handleUpdateOrderStatus(orderId: string, status: Order['status']) {
    await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    loadOrders();
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

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Store className="w-6 h-6 text-orange-500" />
              <span className="text-xl font-bold text-gray-800">Panel de Restaurante</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{profile?.full_name}</span>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
                Salir
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {restaurants.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">No tienes restaurantes</h2>
            <p className="text-gray-600 mb-6">Crea tu primer restaurante para empezar</p>
            <p className="text-gray-600 text-center">Contacta al administrador para crear un nuevo restaurante</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-800">{selectedRestaurant?.name}</h1>
                <p className="text-gray-600">{selectedRestaurant?.address}</p>
              </div>
              {restaurants.length > 1 && (
                <select
                  value={selectedRestaurant?.id || ''}
                  onChange={(e) => {
                    const restaurant = restaurants.find(r => r.id === e.target.value);
                    if (restaurant) setSelectedRestaurant(restaurant);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                >
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm mb-6">
              <div className="border-b">
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

              <div className="p-6">
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

                {activeTab === 'orders' && (
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 mb-6">Pedidos</h2>

                    {orders.length === 0 ? (
                      <div className="text-center py-12">
                        <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                        <p className="text-gray-600">No hay pedidos aún</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left px-4 py-3 font-semibold text-gray-700">Cliente</th>
                              <th className="text-left px-4 py-3 font-semibold text-gray-700">Pedido</th>
                              <th className="text-left px-4 py-3 font-semibold text-gray-700">Fecha</th>
                              <th className="text-left px-4 py-3 font-semibold text-gray-700">Dirección</th>
                              <th className="text-right px-4 py-3 font-semibold text-gray-700">Monto</th>
                              <th className="text-center px-4 py-3 font-semibold text-gray-700">Estado</th>
                              <th className="text-center px-4 py-3 font-semibold text-gray-700">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders.map((order: any) => (
                              <tr key={order.id} className="border-b hover:bg-gray-50 transition">
                                <td className="px-4 py-3 text-sm font-medium text-gray-800">{order.customer?.full_name || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">#{order.id.slice(0, 8)}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">{new Date(order.created_at).toLocaleDateString()} {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{order.delivery_address}</td>
                                <td className="px-4 py-3 text-sm font-bold text-orange-500 text-right">${order.total_amount}</td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.status]}`}>
                                    {statusLabels[order.status]}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={order.status}
                                    onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])}
                                    className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  >
                                    <option value="pending">Pendiente</option>
                                    <option value="confirmed">Confirmado</option>
                                    <option value="preparing">Preparando</option>
                                    <option value="delivering">En camino</option>
                                    <option value="delivered">Entregado</option>
                                    <option value="cancelled">Cancelado</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {showMenuForm && selectedRestaurant && (
        <MenuItemForm
          restaurantId={selectedRestaurant.id}
          onClose={() => { setShowMenuForm(false); loadMenuItems(); }}
        />
      )}

      {editingItem && (
        <MenuItemEditForm
          item={editingItem}
          onClose={() => { setEditingItem(null); loadMenuItems(); }}
        />
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

    const { data, error } = await supabase.storage
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

  async function uploadImage(): Promise<string | null> {
    if (!image) return imagePreview;

    const fileExt = image.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
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
