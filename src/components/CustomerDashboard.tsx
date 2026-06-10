import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase, Restaurant, MenuItem, Order } from '../lib/supabase';
import { useGeolocation } from '../hooks/useGeolocation';
import { LogOut, Store, ShoppingCart, Clock, MapPin, Search, X, User, AlertCircle, CheckCircle } from 'lucide-react';

type CartItem = MenuItem & { quantity: number };

export function CustomerDashboard() {
  const { profile, signOut } = useAuth();
  const { getCurrentLocation, location, error: geoError, loading: geoLoading } = useGeolocation();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showOrders, setShowOrders] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [confirmedLocation, setConfirmedLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    loadRestaurants();
    loadOrders();
  }, []);

  useEffect(() => {
    if (selectedRestaurant) {
      loadMenuItems();
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

  async function loadOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', profile!.id)
      .order('created_at', { ascending: false });

    if (data) setOrders(data);
  }

  function addToCart(item: MenuItem) {
    const existing = cart.find((i) => i.id === item.id);
    if (existing) {
      setCart(cart.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setCart([...cart, { ...item, quantity: 1 }]);
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

  async function handleConfirmLocation() {
    if (!confirmedLocation) {
      confirmedLocation ? setShowLocationConfirm(false) : setShowLocationConfirm(true);
      return;
    }

    await handleCheckout();
  }

  async function handleCheckout() {
    if (!selectedRestaurant || cart.length === 0) {
      alert('Por favor agrega productos al carrito');
      return;
    }

    if (!deliveryAddress.trim()) {
      alert('Por favor ingresa una dirección de entrega');
      return;
    }

    const total = getCartTotal();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: profile!.id,
        restaurant_id: selectedRestaurant.id,
        total_amount: total,
        delivery_address: deliveryAddress,
        status: 'pending',
        latitude: confirmedLocation?.lat ?? null,
        longitude: confirmedLocation?.lng ?? null,
      })
      .select()
      .single();

    if (orderError || !order) {
      alert('Error al crear el pedido');
      return;
    }

    const orderItems = cart.map((item) => ({
      order_id: order.id,
      menu_item_id: item.id,
      quantity: item.quantity,
      unit_price: item.price,
      subtotal: item.price * item.quantity,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    if (itemsError) {
      alert('Error al crear el pedido');
      return;
    }

    setCart([]);
    setShowCart(false);
    setDeliveryAddress('');
    setShowLocationConfirm(false);
    setConfirmedLocation(null);
    loadOrders();
    alert('Pedido realizado con éxito!');
  }

  const filteredRestaurants = restaurants.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <nav className="bg-white shadow-sm border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Store className="w-6 h-6 text-orange-500" />
              <span className="text-xl font-bold text-gray-800">Food Delivery</span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowOrders(!showOrders)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                <Clock className="w-4 h-4" />
                Mis Pedidos
              </button>
              <button
                onClick={() => setShowCart(!showCart)}
                className="relative flex items-center gap-2 px-4 py-2 text-sm text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition"
              >
                <ShoppingCart className="w-4 h-4" />
                Carrito
                {cart.length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                    {cart.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setShowProfile(!showProfile)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                <User className="w-4 h-4" />
                Mi Perfil
              </button>
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
        {!selectedRestaurant ? (
          <div>
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-gray-800 mb-2">Descubre restaurantes increíbles</h1>
              <p className="text-gray-600">Pide tu comida favorita desde la comodidad de tu hogar</p>
            </div>

            <div className="relative mb-8">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Buscar restaurantes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            {filteredRestaurants.length === 0 ? (
              <div className="text-center py-12">
                <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No se encontraron restaurantes</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredRestaurants.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    onClick={() => setSelectedRestaurant(restaurant)}
                    className="bg-white rounded-xl shadow-sm hover:shadow-lg transition cursor-pointer overflow-hidden group"
                  >
                    <div className="h-48 bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
                      <Store className="w-16 h-16 text-white opacity-80" />
                    </div>
                    <div className="p-6">
                      <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-orange-500 transition">
                        {restaurant.name}
                      </h3>
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

            <div className="bg-white rounded-xl shadow-sm p-8 mb-8">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-800 mb-2">{selectedRestaurant.name}</h1>
                  <p className="text-gray-600 mb-2">{selectedRestaurant.description}</p>
                  <div className="flex items-center text-sm text-gray-500">
                    <MapPin className="w-4 h-4 mr-1" />
                    {selectedRestaurant.address}
                  </div>
                </div>
              </div>
            </div>

            {menuItems.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl">
                <p className="text-gray-600">Este restaurante no tiene elementos en el menú aún</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {menuItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition overflow-hidden">
                    <div className="h-40 bg-gradient-to-br from-orange-300 to-orange-500 flex items-center justify-center">
                      <Store className="w-12 h-12 text-white opacity-60" />
                    </div>
                    <div className="p-5">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-gray-800 flex-1">{item.name}</h3>
                        {item.category && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                            {item.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-4 line-clamp-2">{item.description}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-2xl font-bold text-orange-500">${item.price}</span>
                        <button
                          onClick={() => addToCart(item)}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition"
                        >
                          Agregar
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showCart && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">Tu Carrito</h2>
              <button onClick={() => setShowCart(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              {cart.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">Tu carrito está vacío</p>
                </div>
              ) : (
                <div>
                  <div className="space-y-4 mb-6">
                    {cart.map((item) => (
                      <div key={item.id} className="flex items-center gap-4 p-4 border rounded-lg">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-800">{item.name}</h3>
                          <p className="text-sm text-gray-600">${item.price}</p>
                        </div>
                        <div className="flex items-center gap-3">
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
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4 mb-4">
                    <div className="flex justify-between text-xl font-bold mb-6">
                      <span>Total:</span>
                      <span className="text-orange-500">${getCartTotal().toFixed(2)}</span>
                    </div>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Dirección de entrega
                      </label>
                      <input
                        type="text"
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Ingresa tu dirección completa"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>

                    <button
                      onClick={handleRequestLocation}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                    >
                      <MapPin className="w-4 h-4" />
                      {geoLoading ? 'Obteniendo ubicación...' : 'Confirmar ubicación y realizar pedido'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showOrders && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">Mis Pedidos</h2>
              <button onClick={() => setShowOrders(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              {orders.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No tienes pedidos aún</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <div key={order.id} className="border rounded-lg p-5 hover:shadow-md transition">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-medium text-gray-800">Pedido #{order.id.slice(0, 8)}</p>
                          <p className="text-sm text-gray-600">{new Date(order.created_at).toLocaleString()}</p>
                          <div className="flex items-center text-sm text-gray-600 mt-1">
                            <MapPin className="w-4 h-4 mr-1" />
                            {order.delivery_address}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-orange-500">${order.total_amount}</p>
                          <span className={`inline-block text-xs px-3 py-1 rounded-full font-medium mt-2 ${statusColors[order.status]}`}>
                            {statusLabels[order.status]}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showProfile && profile && (
        <ProfileEditForm profile={profile} onClose={() => setShowProfile(false)} />
      )}

      {showLocationConfirm && location && (
        <LocationConfirmationModal
          location={location}
          geoError={geoError}
          onConfirm={(address) => {
            setDeliveryAddress(address);
            setShowLocationConfirm(false);
            handleConfirmLocation();
          }}
          onCancel={() => setShowLocationConfirm(false)}
          onUseManual={() => {
            setShowLocationConfirm(false);
            setConfirmedLocation(null);
          }}
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
  const [loadError, setLoadError] = useState(false);

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

function ProfileEditForm({ profile, onClose }: { profile: any; onClose: () => void }) {
  const [formData, setFormData] = useState({
    full_name: profile.full_name || '',
    phone: profile.phone || '',
    delivery_address: profile.delivery_address || '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

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
