import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceRoleKey}`,
        "apikey": supabaseServiceRoleKey,
      },
      body: JSON.stringify({
        email: "admin@admin.com",
        password: "admin",
        email_confirm: true,
        user_metadata: {
          full_name: "Administrador",
        },
        app_metadata: {
          role: "admin",
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Error creating user:", error);
      return new Response(
        JSON.stringify({ error: error }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userData = await response.json();

    if (!userData.user || !userData.user.id) {
      throw new Error("User creation response missing user id");
    }

    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceRoleKey}`,
        "apikey": supabaseServiceRoleKey,
      },
      body: JSON.stringify({
        id: userData.user.id,
        email: "admin@admin.com",
        full_name: "Administrador",
        role: "admin",
      }),
    });

    if (!profileResponse.ok) {
      const error = await profileResponse.json();
      console.error("Error creating profile:", error);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Admin user created successfully" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
