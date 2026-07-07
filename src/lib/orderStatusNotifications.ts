import { Order, supabase } from './supabase';

export const customerOrderStatusLabels: Record<Order['status'], string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  delivering: 'En camino',
  delivered: 'Entregado',
  closed: 'Mesa cerrada',
  cancelled: 'Cancelado',
};

const customerOrderStatusMessages: Record<Order['status'], string> = {
  pending: 'Tu pedido fue recibido.',
  confirmed: 'Tu pedido fue confirmado.',
  preparing: 'Tu pedido esta en preparacion.',
  delivering: 'Tu pedido esta en camino.',
  delivered: 'Tu pedido fue entregado.',
  closed: 'Tu pedido fue cerrado.',
  cancelled: 'Tu pedido fue cancelado.',
};

const pushNotifiableOrderStatuses = new Set<Order['status']>(['confirmed', 'delivering']);

export function shouldNotifyCustomerOrderStatus(status: Order['status']) {
  return pushNotifiableOrderStatuses.has(status);
}

export function getCustomerOrderStatusMessage(order: Pick<Order, 'id' | 'status'>) {
  return `${customerOrderStatusMessages[order.status]} Pedido #${order.id.slice(0, 8)}.`;
}

export type OrderNotificationPermissionState = NotificationPermission | 'unsupported' | 'registration_failed';

const vapidPublicKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();

function supportsPushNotifications() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && Boolean(vapidPublicKey);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function bufferSourceToUint8Array(source: BufferSource) {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function arraysAreEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function subscriptionUsesApplicationServerKey(subscription: PushSubscription, applicationServerKey: Uint8Array) {
  const existingKey = subscription.options.applicationServerKey;
  return Boolean(existingKey && arraysAreEqual(bufferSourceToUint8Array(existingKey), applicationServerKey));
}

export function getOrderNotificationPermissionState(): OrderNotificationPermissionState {
  if (!supportsPushNotifications()) return 'unsupported';
  return Notification.permission;
}

export async function requestOrderNotificationPermission(): Promise<OrderNotificationPermissionState> {
  if (!supportsPushNotifications()) return 'unsupported';
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    const registered = await registerOrderPushSubscription();
    if (!registered) return 'registration_failed';
  }
  return Notification.permission;
}

export async function registerOrderPushSubscription() {
  if (!supportsPushNotifications() || Notification.permission !== 'granted' || !vapidPublicKey) return false;

  try {
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    const registration = await navigator.serviceWorker.register('/order-push-sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (subscription && !subscriptionUsesApplicationServerKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }

    subscription = subscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const { error } = await supabase.functions.invoke('register-push-subscription', {
      body: { subscription: subscription.toJSON() },
    });

    if (error) {
      console.error('Push subscription registration error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Push subscription registration exception:', error);
    return false;
  }
}

export async function notifyCustomerOrderStatus(orderId: string) {
  const { error } = await supabase.functions.invoke('send-order-notification', {
    body: { orderId },
  });

  if (error) console.error('Push notification error:', error);
}

export async function showOrderBrowserNotification(order: Pick<Order, 'id' | 'status'>) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!shouldNotifyCustomerOrderStatus(order.status)) return;

  const options: NotificationOptions = {
    body: getCustomerOrderStatusMessage(order),
    tag: `order-status-${order.id}`,
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
  } as NotificationOptions;

  const registration = 'serviceWorker' in navigator
    ? await navigator.serviceWorker.ready.catch(() => null)
    : null;

  if (registration) {
    await registration.showNotification('Estado de tu pedido', options);
    return;
  }

  new Notification('Estado de tu pedido', options);
}
