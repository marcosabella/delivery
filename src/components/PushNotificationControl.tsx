import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationState,
  PushNotificationState,
  syncPushSubscription,
} from '../lib/pushNotifications';

const labels: Record<PushNotificationState, string> = {
  unsupported: 'Push no compatible',
  unconfigured: 'Push sin configurar',
  denied: 'Notificaciones bloqueadas',
  disabled: 'Activar notificaciones',
  enabled: 'Notificaciones activas',
};

export function PushNotificationControl() {
  const { user } = useAuth();
  const [state, setState] = useState<PushNotificationState>('disabled');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refreshState = () => void (user ? syncPushSubscription() : Promise.resolve())
      .then(() => getPushNotificationState())
      .then((nextState) => { if (active) setState(nextState); })
      .catch((caughtError) => {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : 'No se pudo comprobar la configuracion push.');
      })
      .finally(() => { if (active) setLoading(false); });

    refreshState();
    window.addEventListener('focus', refreshState);
    document.addEventListener('visibilitychange', refreshState);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshState);
      document.removeEventListener('visibilitychange', refreshState);
    };
  }, [user]);

  if (!user) return null;

  async function togglePush() {
    if (state !== 'enabled' && state !== 'disabled') return;
    setLoading(true);
    setError('');
    try {
      if (state === 'enabled') {
        await disablePushNotifications();
      } else {
        await enablePushNotifications();
      }
      setState(await getPushNotificationState());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo cambiar la configuracion push.');
      setState(await getPushNotificationState());
    } finally {
      setLoading(false);
    }
  }

  const interactive = state === 'enabled' || state === 'disabled';
  const helpText = state === 'denied'
    ? 'Habilita Notificaciones desde el candado o la configuracion del sitio y vuelve a esta pantalla.'
    : '';
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-800">Notificaciones</p>
          <p className="mt-1 text-sm text-slate-500">Recibi avisos sobre el estado de tus pedidos.</p>
        </div>
        <button
          type="button"
          onClick={() => void togglePush()}
          disabled={loading || !interactive}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
          title={state === 'denied' ? 'Habilitalas desde la configuracion del navegador.' : undefined}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'enabled' ? <Bell className="h-4 w-4 text-emerald-600" /> : <BellOff className="h-4 w-4" />}
          {loading ? 'Comprobando...' : labels[state]}
        </button>
      </div>
      {(error || helpText) && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error || helpText}</p>}
    </div>
  );
}
