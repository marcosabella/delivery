import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Auth } from './components/Auth';
import { CustomerDashboard } from './components/CustomerDashboard';
import { RestaurantDashboard } from './components/RestaurantDashboard';
import { AdminDashboard } from './components/AdminDashboard';

function AppContent() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!user || !profile) {
    return <Auth />;
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
