import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceHeaders(serviceRoleKey: string, prefer?: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function parseOptionalCoordinate(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === "") return null;

  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max
    ? coordinate
    : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: "Unauthorized" }, 401);
  }

  let createdOrderId: string | null = null;

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
    });
    if (!userResponse.ok) return json({ error: "Unauthorized" }, 401);
    const caller = await userResponse.json();

    const body = await req.json();
    const restaurantId = String(body.restaurantId || "");
    const requestedCustomerId = String(body.customer?.id || "").trim();
    const fullName = String(body.customer?.fullName || "").trim();
    const deliveryMethod = body.deliveryMethod === "pickup" ? "pickup" : "delivery";
    const deliveryAddress = String(body.deliveryAddress || "").trim();
    const latitude = parseOptionalCoordinate(body.latitude, -90, 90);
    const longitude = parseOptionalCoordinate(body.longitude, -180, 180);
    const hasCoordinates = latitude !== null && longitude !== null;
    const customerNotes = String(body.customerNotes || "").trim() || null;
    const requestedItems = Array.isArray(body.items) ? body.items : [];

    if (!restaurantId) {
      return json({ error: "Faltan datos obligatorios del pedido" }, 400);
    }

    const restaurantResponse = await fetch(
      `${supabaseUrl}/rest/v1/restaurants?id=eq.${encodeURIComponent(restaurantId)}&owner_id=eq.${caller.id}&select=id,address`,
      { headers: serviceHeaders(serviceRoleKey) },
    );
    const restaurants = restaurantResponse.ok ? await restaurantResponse.json() : [];
    if (!restaurants[0]) return json({ error: "Restaurant not found" }, 403);

    if (body.action === "listCustomers") {
      const profileResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?role=eq.customer&select=id,email,full_name,phone,delivery_address&order=full_name.asc&limit=500`,
        { headers: serviceHeaders(serviceRoleKey) },
      );
      if (!profileResponse.ok) {
        return json({ error: "No se pudo obtener la lista de clientes" }, 500);
      }
      const profiles = await profileResponse.json();

      return json({
        customers: profiles.map((profile: Record<string, unknown>) => ({
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          phone: profile.phone,
          deliveryAddress: profile.delivery_address,
        })),
      });
    }

    if (!fullName || requestedItems.length === 0) {
      return json({ error: "Faltan datos obligatorios del pedido" }, 400);
    }
    if (deliveryMethod === "delivery" && !deliveryAddress) {
      return json({ error: "La direccion de entrega es obligatoria" }, 400);
    }

    const quantities = new Map<string, number>();
    for (const item of requestedItems) {
      const menuItemId = String(item.menuItemId || "");
      const quantity = Number(item.quantity);
      if (!menuItemId || !Number.isInteger(quantity) || quantity <= 0) {
        return json({ error: "Hay productos o cantidades invalidas" }, 400);
      }
      quantities.set(menuItemId, (quantities.get(menuItemId) || 0) + quantity);
    }

    const idsFilter = [...quantities.keys()].map(encodeURIComponent).join(",");
    const menuResponse = await fetch(
      `${supabaseUrl}/rest/v1/menu_items?restaurant_id=eq.${encodeURIComponent(restaurantId)}&id=in.(${idsFilter})&is_available=eq.true&select=id,price`,
      { headers: serviceHeaders(serviceRoleKey) },
    );
    const menuItems = menuResponse.ok ? await menuResponse.json() : [];
    if (menuItems.length !== quantities.size) {
      return json({ error: "Uno o mas productos no estan disponibles" }, 400);
    }

    let profiles: Array<{ id: string; role: string }> = [];
    if (requestedCustomerId) {
      const profileResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(requestedCustomerId)}&select=id,role&limit=1`,
        { headers: serviceHeaders(serviceRoleKey) },
      );
      profiles = profileResponse.ok ? await profileResponse.json() : [];
    }
    const customerId = profiles[0]?.id as string | undefined;

    if (requestedCustomerId && (!profiles[0] || profiles[0].role !== "customer")) {
      return json({ error: "El cliente seleccionado no es valido" }, 400);
    }

    const orderItems = menuItems.map((item: { id: string; price: number | string }) => {
      const quantity = quantities.get(item.id)!;
      const unitPrice = Number(item.price);
      return { menu_item_id: item.id, quantity, unit_price: unitPrice, subtotal: unitPrice * quantity };
    });
    const totalAmount = orderItems.reduce((total: number, item: { subtotal: number }) => total + item.subtotal, 0);
    const address = deliveryMethod === "pickup"
      ? String(restaurants[0].address || "Retira en restaurante")
      : deliveryAddress;

    const orderResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey, "return=representation"),
      body: JSON.stringify({
        customer_id: customerId,
        guest_customer_name: customerId ? null : fullName,
        restaurant_id: restaurantId,
        status: "pending",
        total_amount: totalAmount,
        delivery_method: deliveryMethod,
        delivery_address: address,
        latitude: hasCoordinates ? latitude : null,
        longitude: hasCoordinates ? longitude : null,
        customer_notes: customerNotes,
      }),
    });
    const orders = await orderResponse.json();
    if (!orderResponse.ok || !orders[0]) throw new Error("No se pudo crear el pedido");
    createdOrderId = orders[0].id;

    const itemsResponse = await fetch(`${supabaseUrl}/rest/v1/order_items`, {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey, "return=minimal"),
      body: JSON.stringify(orderItems.map((item: Record<string, unknown>) => ({ ...item, order_id: createdOrderId }))),
    });
    if (!itemsResponse.ok) throw new Error("No se pudo guardar el detalle del pedido");

    return json({ orderId: createdOrderId, customerAssociated: Boolean(customerId) }, 201);
  } catch (error) {
    if (createdOrderId) {
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${createdOrderId}`, {
        method: "DELETE",
        headers: serviceHeaders(serviceRoleKey),
      });
    }
    return json({ error: error instanceof Error ? error.message : "Error al crear el pedido" }, 500);
  }
});
