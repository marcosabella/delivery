import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version",
};

const statusMessages: Record<string, string> = {
  pending: "Tu pedido fue recibido.",
  confirmed: "Tu pedido fue confirmado.",
  preparing: "Tu pedido esta en preparacion.",
  delivering: "Tu pedido esta en camino.",
  delivered: "Tu pedido fue entregado.",
  closed: "Tu pedido fue cerrado.",
  cancelled: "Tu pedido fue cancelado.",
};

const pushNotifiableStatuses = new Set(["confirmed", "delivering"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceHeaders(serviceRoleKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
  };
}

async function hasOrderAccess(
  supabaseUrl: string,
  serviceRoleKey: string,
  callerId: string,
  order: { id: string; restaurant_id: string },
) {
  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=role&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  if (profiles[0]?.role === "admin") return true;

  const restaurantResponse = await fetch(
    `${supabaseUrl}/rest/v1/restaurants?id=eq.${encodeURIComponent(order.restaurant_id)}&owner_id=eq.${encodeURIComponent(callerId)}&select=id&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const restaurants = restaurantResponse.ok ? await restaurantResponse.json() : [];
  if (restaurants[0]) return true;

  const waiterResponse = await fetch(
    `${supabaseUrl}/rest/v1/restaurant_waiters?restaurant_id=eq.${encodeURIComponent(order.restaurant_id)}&waiter_id=eq.${encodeURIComponent(callerId)}&is_active=eq.true&select=waiter_id&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const waiters = waiterResponse.ok ? await waiterResponse.json() : [];
  if (waiters[0]) return true;

  const driverResponse = await fetch(
    `${supabaseUrl}/rest/v1/delivery_route_orders?order_id=eq.${encodeURIComponent(order.id)}&select=route:delivery_routes!inner(driver_id,status)&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const routeOrders = driverResponse.ok ? await driverResponse.json() : [];
  return routeOrders.some((routeOrder: { route?: { driver_id?: string; status?: string } }) =>
    routeOrder.route?.driver_id === callerId
    && (routeOrder.route.status === "assigned" || routeOrder.route.status === "in_progress")
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "Missing VAPID configuration" }, 500);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return json({ error: "Unauthorized" }, 401);
  const caller = await userResponse.json();

  const body = await req.json();
  const orderId = String(body.orderId || "");
  if (!orderId) return json({ error: "Missing orderId" }, 400);

  const orderResponse = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,customer_id,restaurant_id,status&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const orders = orderResponse.ok ? await orderResponse.json() : [];
  const order = orders[0] as { id: string; customer_id: string | null; restaurant_id: string; status: string } | undefined;
  if (!order) return json({ error: "Order not found" }, 404);
  if (!pushNotifiableStatuses.has(order.status)) return json({ ok: true, sent: 0, skipped: true });
  if (!order.customer_id) return json({ ok: true, sent: 0 });

  const canNotify = await hasOrderAccess(supabaseUrl, serviceRoleKey, caller.id, order);
  if (!canNotify) return json({ error: "Order access denied" }, 403);

  const subscriptionResponse = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(order.customer_id)}&select=id,endpoint,p256dh,auth`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const subscriptions = subscriptionResponse.ok ? await subscriptionResponse.json() : [];
  if (subscriptions.length === 0) return json({ ok: true, sent: 0 });

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: "Estado de tu pedido",
    body: `${statusMessages[order.status] || "Tu pedido fue actualizado."} Pedido #${order.id.slice(0, 8)}.`,
    tag: `order-status-${order.id}`,
    data: { orderId: order.id, url: "/" },
  });

  let sent = 0;
  const staleSubscriptionIds: string[] = [];

  await Promise.all(subscriptions.map(async (subscription: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      sent += 1;
    } catch (error) {
      const statusCode = error instanceof Error && "statusCode" in error
        ? Number((error as Error & { statusCode: number }).statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) staleSubscriptionIds.push(subscription.id);
    }
  }));

  if (staleSubscriptionIds.length > 0) {
    await fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?id=in.(${staleSubscriptionIds.map(encodeURIComponent).join(",")})`,
      { method: "DELETE", headers: serviceHeaders(serviceRoleKey) },
    );
  }

  return json({ ok: true, sent });
});
