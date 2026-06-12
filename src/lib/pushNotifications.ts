import { supabase } from './supabase';

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushNotificationState = 'unsupported' | 'unconfigured' | 'denied' | 'disabled' | 'enabled';

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function applicationServerKeyMatches(subscription: PushSubscription, expectedKey: Uint8Array) {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;

  const currentBytes = new Uint8Array(currentKey);
  return currentBytes.length === expectedKey.length
    && currentBytes.every((value, index) => value === expectedKey[index]);
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function validatePushEnvironment() {
  if (!window.isSecureContext) {
    throw new Error('Las notificaciones requieren abrir el sitio publicado con HTTPS.');
  }
  if (isIos() && !isStandaloneDisplay()) {
    throw new Error('En iPhone o iPad, agrega este sitio a la pantalla de inicio y abre la app instalada para activar notificaciones.');
  }
}

async function getRegistration() {
  return navigator.serviceWorker.getRegistration();
}

async function ensureRegistration() {
  const existingRegistration = await getRegistration();
  if (existingRegistration) {
    await existingRegistration.update();
    return navigator.serviceWorker.ready;
  }

  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function getPushNotificationState(): Promise<PushNotificationState> {
  if (!isPushSupported()) return 'unsupported';
  if (!vapidPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';

  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'enabled' : 'disabled';
}

export async function enablePushNotifications() {
  if (!isPushSupported()) throw new Error('Este navegador no admite notificaciones push.');
  if (!vapidPublicKey) throw new Error('Falta configurar VITE_VAPID_PUBLIC_KEY.');
  validatePushEnvironment();

  if (Notification.permission === 'denied') {
    throw new Error('Las notificaciones estan bloqueadas para este sitio. Habilitalas desde el candado de la barra de direcciones y vuelve a intentarlo.');
  }

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Bloqueaste las notificaciones. Habilitalas desde el candado de la barra de direcciones y vuelve a intentarlo.');
  }
  if (permission !== 'granted') {
    throw new Error('No se completo la solicitud. Cuando aparezca el aviso del navegador, selecciona Permitir.');
  }

  const registration = await ensureRegistration();
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  if (subscription && !applicationServerKeyMatches(subscription, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  subscription = subscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('La suscripcion push no devolvio claves validas.');

  const { error } = await supabase.rpc('register_push_subscription', {
    subscription_endpoint: subscription.endpoint,
    subscription_p256dh: keys.p256dh,
    subscription_auth: keys.auth,
    subscription_user_agent: navigator.userAgent,
  });

  if (error) {
    await subscription.unsubscribe();
    throw error;
  }
}

export async function disablePushNotifications() {
  if (!isPushSupported()) return;

  const registration = await getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', subscription.endpoint);
  if (error) throw error;

  await subscription.unsubscribe();
}
