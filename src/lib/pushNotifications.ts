import { supabase } from './supabase';

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushNotificationState = 'unsupported' | 'unconfigured' | 'denied' | 'disabled' | 'enabled';

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

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('El permiso de notificaciones no fue concedido.');

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
