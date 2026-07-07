import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, DishCategory, Profile, Restaurant } from '../lib/supabase';
import { LogOut, Users, Store, Plus, Trash2, Search, Eye, EyeOff, CreditCard as Edit, Menu, Tags, X } from 'lucide-react';
import { MessageModal } from './MessageModal';

export function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'restaurants' | 'categories' | 'users'>('restaurants');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [dishCategories, setDishCategories] = useState<DishCategory[]>([]);
  const [showCreateRestaurant, setShowCreateRestaurant] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState<Restaurant | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<DishCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    loadRestaurants();
    loadUsers();
    loadDishCategories();
  }, []);

  async function loadRestaurants() {
    const { data } = await supabase
      .from('restaurants')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setRestaurants(data);
  }

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setUsers(data);
  }

  async function loadDishCategories() {
    const { data } = await supabase
      .from('dish_categories')
      .select('*')
      .order('sort_order')
      .order('name');

    if (data) setDishCategories(data);
  }

  async function handleToggleCategory(category: DishCategory) {
    const { error } = await supabase
      .from('dish_categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id);

    if (error) setErrorMessage(`No se pudo actualizar la categoria: ${error.message}`);
    else await loadDishCategories();
  }

  async function handleDeleteCategory(category: DishCategory) {
    if (!confirm(`¿Eliminar la categoria "${category.name}"?`)) return;

    const { error } = await supabase.from('dish_categories').delete().eq('id', category.id);
    if (error) {
      setErrorMessage('No se puede eliminar una categoria que esta siendo utilizada por platos. Puedes desactivarla.');
      return;
    }

    await loadDishCategories();
  }

  async function handleToggleRestaurant(id: string, isActive: boolean) {
    await supabase
      .from('restaurants')
      .update({ is_active: !isActive, updated_at: new Date().toISOString() })
      .eq('id', id);

    loadRestaurants();
  }

  async function handleDeleteRestaurant(id: string) {
    if (confirm('¿Estás seguro de que deseas eliminar este restaurante?')) {
      await supabase.from('restaurants').delete().eq('id', id);
      loadRestaurants();
    }
  }

  async function handleDeleteUser(id: string) {
    if (confirm('¿Estás seguro de que deseas eliminar este usuario?')) {
      const { error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'delete', userId: id },
      });

      if (error) {
        setErrorMessage(`No se pudo eliminar el usuario: ${error.message}`);
        return;
      }

      await loadUsers();
    }
  }

  const filteredRestaurants = restaurants.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredUsers = users.filter((u) =>
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const roleLabels: Record<string, string> = {
    customer: 'Cliente',
    restaurant_owner: 'Dueño de Restaurante',
    admin: 'Administrador',
    driver: 'Repartidor',
    waiter: 'Mozo',
  };

  const adminNavItems = [
    { id: 'restaurants' as const, label: 'Restaurantes', icon: Store },
    { id: 'categories' as const, label: 'Categorias', icon: Tags },
    { id: 'users' as const, label: 'Usuarios', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:flex">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500">
            <Store className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Panel Admin</p>
            <p className="text-xs text-slate-500">Sistema pedidos</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSearchQuery('');
                }}
                className={`flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                  isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
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
                <p className="truncate text-sm font-semibold text-slate-900">Panel Admin</p>
                <p className="truncate text-xs text-slate-500">Sistema pedidos</p>
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
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSearchQuery('');
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`flex w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                    isActive ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
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
              <span className="text-sm font-semibold">Panel Admin</span>
            </div>
            <button onClick={() => signOut()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Salir">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="px-3 py-4 sm:px-5 lg:px-6 lg:py-5">

        {activeTab === 'restaurants' && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Gestión de Restaurantes</h2>
              <button
                onClick={() => setShowCreateRestaurant(true)}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-md text-sm font-medium transition"
              >
                <Plus className="w-4 h-4" />
                Nuevo Restaurante
              </button>
            </div>

            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar restaurante..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>

            {filteredRestaurants.length === 0 ? (
              <div className="rounded-lg bg-white p-8 text-center shadow-sm">
                <Store className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-gray-600">No hay restaurantes registrados</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Nombre</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Dueño</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Dirección</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Estado</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredRestaurants.map((restaurant) => {
                        const owner = users.find((u) => u.id === restaurant.owner_id);
                        return (
                          <tr key={restaurant.id} className="hover:bg-gray-50 transition">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-medium text-gray-800">{restaurant.name}</p>
                                <p className="text-sm text-gray-600">{restaurant.description}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700">{owner?.full_name || 'N/A'}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{restaurant.address || 'N/A'}</td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                                  restaurant.is_active
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {restaurant.is_active ? 'Activo' : 'Inactivo'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setEditingRestaurant(restaurant)}
                                  className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                                  title="Editar"
                                >
                                  <Edit className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={() =>
                                    handleToggleRestaurant(restaurant.id, restaurant.is_active)
                                  }
                                  className="p-2 text-green-500 hover:bg-green-50 rounded-lg transition"
                                  title={restaurant.is_active ? 'Desactivar' : 'Activar'}
                                >
                                  {restaurant.is_active ? (
                                    <Eye className="w-5 h-5" />
                                  ) : (
                                    <EyeOff className="w-5 h-5" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDeleteRestaurant(restaurant.id)}
                                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'categories' && (
          <div>
            <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Categorias de platos</h2>
                <p className="mt-1 text-sm text-gray-500">Catalogo unico para todos los restaurantes y los filtros de la landing.</p>
              </div>
              <button
                onClick={() => setShowCategoryForm(true)}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 font-medium text-white transition hover:bg-orange-600"
              >
                <Plus className="h-5 w-5" />
                Nueva categoria
              </button>
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              {dishCategories.length === 0 ? (
                <div className="p-12 text-center text-gray-500">
                  <Tags className="mx-auto mb-4 h-14 w-14 text-gray-300" />
                  No hay categorias configuradas.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Orden</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Categoria</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Estado</th>
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {dishCategories.map((category) => (
                        <tr key={category.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-600">{category.sort_order}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-orange-50">
                                {category.image_url ? <img src={category.image_url} alt="" className="h-full w-full object-cover" /> : <Tags className="m-auto mt-3 h-6 w-6 text-orange-300" />}
                              </div>
                              <div>
                                <p className="font-medium text-gray-800">{category.name}</p>
                                <p className="mt-0.5 max-w-md line-clamp-1 text-xs text-gray-500">{category.description || 'Sin descripcion'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => void handleToggleCategory(category)}
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${category.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                            >
                              {category.is_active ? 'Activa' : 'Inactiva'}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setEditingCategory(category)} className="rounded-lg p-2 text-blue-500 hover:bg-blue-50" title="Editar">
                                <Edit className="h-5 w-5" />
                              </button>
                              <button onClick={() => void handleDeleteCategory(category)} className="rounded-lg p-2 text-red-500 hover:bg-red-50" title="Eliminar">
                                <Trash2 className="h-5 w-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Gestión de Usuarios</h2>
              <button
                onClick={() => setShowCreateUser(true)}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition"
              >
                <Plus className="w-5 h-5" />
                Nuevo Usuario
              </button>
            </div>

            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar usuario por nombre o email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No hay usuarios registrados</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Nombre</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Teléfono</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Rol</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Fecha Registro</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredUsers.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50 transition">
                          <td className="px-6 py-4">
                            <p className="font-medium text-gray-800">{user.full_name}</p>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{user.email}</td>
                          <td className="px-6 py-4 text-sm text-gray-700">{user.phone || 'N/A'}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                                user.role === 'admin'
                                  ? 'bg-purple-100 text-purple-700'
                                  : user.role === 'restaurant_owner'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {roleLabels[user.role]}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {new Date(user.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setEditingUser(user)}
                                className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                                title="Editar"
                              >
                                <Edit className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        </main>
      </div>

      {showCreateRestaurant && (
        <CreateRestaurantModal
          onClose={() => {
            setShowCreateRestaurant(false);
            loadRestaurants();
          }}
          availableOwners={users.filter((u) => u.role === 'restaurant_owner')}
        />
      )}

      {editingRestaurant && (
        <EditRestaurantModal
          restaurant={editingRestaurant}
          onClose={() => {
            setEditingRestaurant(null);
            loadRestaurants();
          }}
          availableOwners={users.filter((u) => u.role === 'restaurant_owner')}
        />
      )}

      {showCreateUser && (
        <CreateUserModal
          onClose={() => {
            setShowCreateUser(false);
            loadUsers();
            loadRestaurants();
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => {
            setEditingUser(null);
            loadUsers();
          }}
        />
      )}

      {(showCategoryForm || editingCategory) && (
        <DishCategoryModal
          category={editingCategory}
          onClose={() => {
            setShowCategoryForm(false);
            setEditingCategory(null);
            loadDishCategories();
          }}
        />
      )}

      {errorMessage && (
        <MessageModal type="error" message={errorMessage} onClose={() => setErrorMessage('')} />
      )}
    </div>
  );
}

function makeCategorySlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function DishCategoryModal({ category, onClose }: { category: DishCategory | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(category?.image_url || '');
  const [sortOrder, setSortOrder] = useState(category?.sort_order.toString() || '0');
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    const slug = makeCategorySlug(cleanName);
    if (!slug) {
      setError('Ingresa un nombre valido.');
      return;
    }

    setLoading(true);
    setError('');
    let imageUrl = category?.image_url || null;

    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024) {
        setError('La imagen no puede superar los 5 MB.');
        setLoading(false);
        return;
      }

      const extension = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const imagePath = `categories/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from('category-images').upload(imagePath, imageFile, {
        cacheControl: '3600',
        contentType: imageFile.type,
      });

      if (upload.error) {
        setError(`No se pudo cargar la imagen: ${upload.error.message}`);
        setLoading(false);
        return;
      }

      imageUrl = supabase.storage.from('category-images').getPublicUrl(imagePath).data.publicUrl;
    }

    const payload = {
      name: cleanName,
      slug,
      description: description.trim() || null,
      image_url: imageUrl,
      sort_order: Math.max(0, Number.parseInt(sortOrder, 10) || 0),
      is_active: isActive,
    };
    const result = category
      ? await supabase.from('dish_categories').update(payload).eq('id', category.id)
      : await supabase.from('dish_categories').insert(payload);

    if (result.error) {
      setError(result.error.code === '23505' ? 'Ya existe una categoria con ese nombre.' : result.error.message);
      setLoading(false);
      return;
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6">
        <h2 className="mb-4 text-2xl font-bold text-gray-800">{category ? 'Editar categoria' : 'Nueva categoria'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Nombre
            <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Descripcion
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder="Describe brevemente esta categoria" />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Foto
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setImageFile(file);
                if (file) setImagePreview(URL.createObjectURL(file));
              }}
              className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-50 file:px-4 file:py-2 file:font-semibold file:text-orange-700 hover:file:bg-orange-100"
            />
            <span className="mt-1 block text-xs font-normal text-gray-500">JPG, PNG, WEBP o GIF. Maximo 5 MB.</span>
          </label>
          {imagePreview && <img src={imagePreview} alt="Vista previa" className="h-40 w-full rounded-xl object-cover" />}
          <label className="block text-sm font-medium text-gray-700">
            Orden
            <input type="number" min="0" required value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" />
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-orange-500" />
            Disponible para restaurantes y filtros
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button disabled={loading} className="flex-1 rounded-lg bg-orange-500 px-4 py-2 text-white hover:bg-orange-600 disabled:opacity-50">{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateRestaurantModal({
  onClose,
  availableOwners,
}: {
  onClose: () => void;
  availableOwners: Profile[];
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    phone: '',
    address: '',
    ownerId: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.name.trim() || !formData.ownerId) {
        setError('El nombre y dueño del restaurante son requeridos');
        setLoading(false);
        return;
      }

      const { error: insertError } = await supabase.from('restaurants').insert({
        owner_id: formData.ownerId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        phone: formData.phone.trim() || null,
        address: formData.address.trim() || null,
        is_active: true,
      });

      if (insertError) {
        setError(`Error: ${insertError.message}`);
        setLoading(false);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Crear Restaurante</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
            <input
              type="text"
              required
              disabled={loading}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dueño *</label>
            <select
              required
              disabled={loading}
              value={formData.ownerId}
              onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            >
              <option value="">Seleccionar dueño</option>
              {availableOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.full_name} ({owner.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
            <textarea
              disabled={loading}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              disabled={loading}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
            <input
              type="text"
              disabled={loading}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [formData, setFormData] = useState({
    fullName: user.full_name,
    phone: user.phone || '',
    role: user.role as Profile['role'],
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.fullName.trim()) {
        setError('El nombre es requerido');
        setLoading(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: formData.fullName.trim(),
          phone: formData.phone.trim() || null,
          role: formData.role,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        setError(`Error: ${updateError.message}`);
        setLoading(false);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Editar Usuario</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input
              type="email"
              disabled
              value={user.email}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600"
            />
            <p className="text-xs text-gray-500 mt-1">El email no puede ser editado</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
            <input
              type="text"
              required
              disabled={loading}
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              disabled={loading}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Rol *</label>
            <select
              required
              disabled={loading}
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as Profile['role'] })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            >
              <option value="customer">Cliente</option>
              <option value="restaurant_owner">Dueño de Restaurante</option>
              <option value="admin">Administrador</option>
              <option value="driver">Repartidor</option>
            </select>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditRestaurantModal({
  restaurant,
  onClose,
  availableOwners,
}: {
  restaurant: Restaurant;
  onClose: () => void;
  availableOwners: Profile[];
}) {
  const [formData, setFormData] = useState({
    name: restaurant.name,
    description: restaurant.description || '',
    phone: restaurant.phone || '',
    address: restaurant.address || '',
    ownerId: restaurant.owner_id,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.name.trim()) {
        setError('El nombre del restaurante es requerido');
        setLoading(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('restaurants')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          phone: formData.phone.trim() || null,
          address: formData.address.trim() || null,
          owner_id: formData.ownerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', restaurant.id);

      if (updateError) {
        setError(`Error: ${updateError.message}`);
        setLoading(false);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Editar Restaurante</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre *</label>
            <input
              type="text"
              required
              disabled={loading}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dueño *</label>
            <select
              required
              disabled={loading}
              value={formData.ownerId}
              onChange={(e) => setFormData({ ...formData, ownerId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            >
              {availableOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.full_name} ({owner.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
            <textarea
              disabled={loading}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              disabled={loading}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
            <input
              type="text"
              disabled={loading}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    role: 'restaurant_owner' as Profile['role'],
    restaurantName: '',
    restaurantAddress: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!formData.email.trim() || !formData.password.trim() || !formData.fullName.trim()) {
        setError('Email, contraseña y nombre son requeridos');
        setLoading(false);
        return;
      }

      if (formData.password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        setLoading(false);
        return;
      }

      if (formData.role === 'restaurant_owner' && !formData.restaurantName.trim()) {
        setError('El nombre del restaurante es requerido');
        setLoading(false);
        return;
      }

      const { error: createError } = await supabase.functions.invoke('admin-users', {
        body: {
          action: 'create',
          email: formData.email.trim(),
          password: formData.password,
          fullName: formData.fullName.trim(),
          phone: formData.phone.trim() || null,
          role: formData.role,
          restaurantName: formData.restaurantName.trim() || null,
          restaurantAddress: formData.restaurantAddress.trim() || null,
        },
      });

      if (createError) throw createError;

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Crear Usuario</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
            <input
              type="text"
              required
              disabled={loading}
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
            <input
              type="email"
              required
              disabled={loading}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={loading}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              disabled={loading}
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Rol *</label>
            <select
              required
              disabled={loading}
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as Profile['role'] })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
            >
              <option value="customer">Cliente</option>
              <option value="restaurant_owner">Dueño de Restaurante</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          {formData.role === 'restaurant_owner' && (
            <div className="space-y-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-medium text-orange-900">Restaurante asignado</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del restaurante *</label>
                <input
                  type="text"
                  required
                  disabled={loading}
                  value={formData.restaurantName}
                  onChange={(e) => setFormData({ ...formData, restaurantName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dirección del restaurante</label>
                <input
                  type="text"
                  disabled={loading}
                  value={formData.restaurantAddress}
                  onChange={(e) => setFormData({ ...formData, restaurantAddress: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent disabled:bg-gray-100"
                />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
