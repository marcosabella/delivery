import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version",
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

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return json({ error: "Unauthorized" }, 401);
  const user = await userResponse.json();

  const body = await req.json();
  const subscription = body.subscription || {};
  const endpoint = String(subscription.endpoint || "");
  const p256dh = String(subscription.keys?.p256dh || "");
  const auth = String(subscription.keys?.auth || "");

  if (!endpoint || !p256dh || !auth) {
    return json({ error: "Invalid subscription" }, 400);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify({
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent"),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return json({ error: "No se pudo registrar el dispositivo" }, 500);
  }

  return json({ ok: true });
});
