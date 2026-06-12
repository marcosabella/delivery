import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationState,
  PushNotificationState,
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
    void getPushNotificationState()
      .then((nextState) => { if (active) setState(nextState); })
      .catch((caughtError) => {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : 'No se pudo comprobar la configuracion push.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

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
  return (
    <div className="fixed bottom-4 left-4 z-[80] max-w-[calc(100%-2rem)]">
      <button
        type="button"
        onClick={() => void togglePush()}
        disabled={loading || !interactive}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
        title={state === 'denied' ? 'Habilitalas desde la configuracion del navegador.' : undefined}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'enabled' ? <Bell className="h-4 w-4 text-emerald-600" /> : <BellOff className="h-4 w-4" />}
        {loading ? 'Comprobando...' : labels[state]}
      </button>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 shadow">{error}</p>}
    </div>
  );
}
