import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type OrderRecord = {
  id: string;
  customer_id: string | null;
  restaurant_id: string;
  status: string;
  total_amount: number;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: OrderRecord | null;
  old_record: OrderRecord | null;
};

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function customerMessage(order: OrderRecord) {
  const shortId = order.id.slice(0, 8);
  const messages: Record<string, { title: string; body: string }> = {
    confirmed: { title: "Pedido confirmado", body: `El restaurante confirmo tu pedido #${shortId}.` },
    preparing: { title: "Pedido en preparacion", body: `Tu pedido #${shortId} ya esta en cocina.` },
    delivering: { title: "Pedido en reparto", body: `Tu pedido #${shortId} ya esta en camino.` },
    delivered: { title: "Pedido entregado", body: `El pedido #${shortId} fue marcado como entregado.` },
    cancelled: { title: "Pedido cancelado", body: `El pedido #${shortId} fue cancelado.` },
  };
  return messages[order.status];
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  const suppliedSecret = request.headers.get("x-webhook-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!webhookSecret || suppliedSecret !== webhookSecret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "Missing server configuration" }, 500);
  }

  const payload = await request.json() as WebhookPayload;
  if (payload.schema !== "public" || payload.table !== "orders" || !payload.record) {
    return json({ skipped: true, reason: "Unsupported webhook payload" });
  }

  const order = payload.record;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let recipientIds: string[] = [];
  let notification: { title: string; body: string } | undefined;

  if (payload.type === "INSERT") {
    const { data: restaurant, error } = await supabase
      .from("restaurants")
      .select("owner_id,name")
      .eq("id", order.restaurant_id)
      .single();
    if (error) throw error;
    recipientIds = [restaurant.owner_id];
    notification = {
      title: `Nuevo pedido en ${restaurant.name}`,
      body: `Pedido #${order.id.slice(0, 8)} por $${Number(order.total_amount).toLocaleString("es-AR")}.`,
    };
  } else if (payload.type === "UPDATE" && payload.old_record?.status !== order.status && order.customer_id) {
    recipientIds = [order.customer_id];
    notification = customerMessage(order);
  }

  if (!notification || recipientIds.length === 0) return json({ skipped: true, reason: "No notification required" });

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", recipientIds) as { data: PushSubscriptionRow[] | null; error: Error | null };
  if (error) throw error;

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const expiredEndpoints: string[] = [];
  const results = await Promise.allSettled((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({
        ...notification,
        tag: `order-${order.id}-${order.status}`,
        url: "/",
      }), { TTL: 3600, urgency: "high" });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) expiredEndpoints.push(subscription.endpoint);
      throw error;
    }
  }));

  if (expiredEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
  }

  return json({
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  });
});
