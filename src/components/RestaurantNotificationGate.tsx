import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  enablePushNotifications,
  getPushNotificationState,
  PushNotificationState,
  syncPushSubscription,
} from '../lib/pushNotifications';

type RestaurantNotificationGateProps = {
  children: ReactNode;
};

export function RestaurantNotificationGate({ children }: RestaurantNotificationGateProps) {
  const { signOut } = useAuth();
  const [state, setState] = useState<PushNotificationState>('disabled');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshState = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await syncPushSubscription();
      let nextState = await getPushNotificationState();

      // When permission already exists, restore a missing subscription without user input.
      if (nextState === 'disabled' && Notification.permission === 'granted') {
        await enablePushNotifications();
        nextState = await getPushNotificationState();
      }

      setState(nextState);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo comprobar la configuracion push.');
      setState(await getPushNotificationState());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshState();
    };

    window.addEventListener('focus', refreshState);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshState]);

  async function activateNotifications() {
    setLoading(true);
    setError('');
    try {
      await enablePushNotifications();
      setState(await getPushNotificationState());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudieron activar las notificaciones.');
      setState(await getPushNotificationState());
    } finally {
      setLoading(false);
    }
  }

  if (state === 'enabled') return children;

  const blockedMessage = state === 'denied'
    ? 'Las notificaciones estan bloqueadas. Habilitalas desde el candado o la configuracion del sitio y vuelve a esta pantalla.'
    : state === 'unsupported'
      ? 'Este navegador no admite notificaciones push. Usa un navegador compatible para ingresar al panel.'
      : state === 'unconfigured'
        ? 'Las notificaciones push no estan configuradas en esta instalacion.'
        : 'Para recibir los pedidos en el momento, debes permitir las notificaciones antes de ingresar al panel.';
  const canActivate = state === 'disabled';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 text-orange-600">
          <Bell className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-900">Notificaciones obligatorias</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{blockedMessage}</p>

        {(error || state === 'denied') && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || blockedMessage}</p>
        )}

        <div className="mt-6 space-y-3">
          {canActivate && (
            <button
              type="button"
              onClick={() => void activateNotifications()}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bell className="h-5 w-5" />}
              {loading ? 'Activando...' : 'Activar notificaciones'}
            </button>
          )}
          {!canActivate && (
            <button
              type="button"
              onClick={() => void refreshState()}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading && <Loader2 className="h-5 w-5 animate-spin" />}
              Comprobar nuevamente
            </button>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <LogOut className="h-5 w-5" />
            Cerrar sesion
          </button>
        </div>
      </section>
    </main>
  );
}
