import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Auth } from './components/Auth';
import { CustomerDashboard } from './components/CustomerDashboard';
import { RestaurantDashboard } from './components/RestaurantDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { DriverDashboard } from './components/DriverDashboard';

function AppContent() {
  const { user, profile, loading, authError, retryProfile, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow">
          <h1 className="text-xl font-semibold text-gray-900">No se pudo cargar el panel</h1>
          <p className="mt-2 text-sm text-gray-600">
            {authError || 'La sesión está activa, pero no se encontró el perfil asociado.'}
          </p>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => retryProfile()}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Volver al login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (profile.role === 'admin') {
    return <AdminDashboard />;
  }

  if (profile.role === 'customer') {
    return <CustomerDashboard />;
  }

  if (profile.role === 'restaurant_owner') {
    return <RestaurantDashboard />;
  }

  if (profile.role === 'driver') {
    return <DriverDashboard />;
  }

  return null;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
