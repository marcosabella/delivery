import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RestaurantDashboard } from './components/RestaurantDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { DriverDashboard } from './components/DriverDashboard';
import { Landing } from './components/Landing';
import { isSupabaseConfigured, missingSupabaseEnv } from './lib/supabase';

function ConfigurationError() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12">
      <section className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Configuracion pendiente</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">No se pudo conectar la aplicacion</h1>
        <p className="mt-3 text-slate-600">
          Faltan variables de entorno de Supabase. Agregalas en un archivo <code>.env</code> y reinicia el servidor.
        </p>
        <ul className="mt-4 space-y-2">
          {missingSupabaseEnv.map((name) => (
            <li key={name} className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800">
              {name}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-500">Usa <code>.env.example</code> como referencia.</p>
      </section>
    </main>
  );
}

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
    return <Landing />;
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
    return <Landing />;
  }

  if (profile.role === 'restaurant_owner') {
    return <RestaurantDashboard />;
  }

  if (profile.role === 'driver') {
    return <DriverDashboard />;
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold text-gray-900">Perfil sin acceso configurado</h1>
        <p className="mt-2 text-sm text-gray-600">
          El rol &quot;{profile.role || 'sin definir'}&quot; no corresponde a un panel disponible.
        </p>
        <button
          type="button"
          onClick={() => signOut()}
          className="mt-5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
        >
          Volver al login
        </button>
      </div>
    </div>
  );
}

function App() {
  if (!isSupabaseConfigured) {
    return <ConfigurationError />;
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
