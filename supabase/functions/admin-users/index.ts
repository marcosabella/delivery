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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
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

    const caller = await userResponse.json();
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${caller.id}&select=role,email`,
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      },
    );
    const profiles = profileResponse.ok ? await profileResponse.json() : [];
    const callerRole = profiles[0]?.role;

    const body = await req.json();

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const fullName = String(body.fullName || "").trim();
      const phone = body.phone ? String(body.phone).trim() : null;
      const allowedRoles = ["customer", "restaurant_owner", "admin", "driver", "waiter"];
      const role = allowedRoles.includes(body.role) ? body.role : "customer";
      const restaurantId = body.restaurantId ? String(body.restaurantId) : null;
      const restaurantName = String(body.restaurantName || "").trim();
      const restaurantAddress = body.restaurantAddress
        ? String(body.restaurantAddress).trim()
        : null;

      if (callerRole !== "admin" && !(callerRole === "restaurant_owner" && (role === "driver" || role === "waiter"))) {
        return json({ error: "User creation access denied" }, 403);
      }
      if ((role === "driver" || role === "waiter") && !restaurantId) {
        return json({ error: "Restaurant is required for staff users" }, 400);
      }
      if ((role === "driver" || role === "waiter") && callerRole === "restaurant_owner") {
        const ownershipResponse = await fetch(
          `${supabaseUrl}/rest/v1/restaurants?id=eq.${restaurantId}&owner_id=eq.${caller.id}&select=id`,
          { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
        );
        const ownedRestaurants = ownershipResponse.ok ? await ownershipResponse.json() : [];
        if (!ownedRestaurants.length) return json({ error: "Restaurant access denied" }, 403);
      }

      if (!email || !fullName || password.length < 6) {
        return json({ error: "Invalid user data" }, 400);
      }
      if (role === "restaurant_owner" && !restaurantName) {
        return json({ error: "Restaurant name is required" }, 400);
      }

      const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, phone },
          app_metadata: { role, managed_by_admin: true },
        }),
      });

      const created = await createResponse.json();
      if (!createResponse.ok) return json({ error: created.message || created }, createResponse.status);

      const updateProfileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email, full_name: fullName, phone, role, updated_at: new Date().toISOString() }),
      });

      if (!updateProfileResponse.ok) {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${created.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
        });
        return json({ error: "Could not create user profile" }, 500);
      }

      if (role === "restaurant_owner") {
        const createRestaurantResponse = await fetch(`${supabaseUrl}/rest/v1/restaurants`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            owner_id: created.id,
            name: restaurantName,
            address: restaurantAddress,
            phone,
            is_active: true,
          }),
        });

        if (!createRestaurantResponse.ok) {
          await fetch(`${supabaseUrl}/auth/v1/admin/users/${created.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          });
          return json({ error: "Could not create restaurant" }, 500);
        }
      }

      if (role === "driver" || role === "waiter") {
        const assignmentTable = role === "driver" ? "restaurant_drivers" : "restaurant_waiters";
        const assignmentUserField = role === "driver" ? "driver_id" : "waiter_id";
        const assignmentResponse = await fetch(`${supabaseUrl}/rest/v1/${assignmentTable}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ restaurant_id: restaurantId, [assignmentUserField]: created.id, is_active: true }),
        });

        if (!assignmentResponse.ok) {
          await fetch(`${supabaseUrl}/auth/v1/admin/users/${created.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          });
          return json({ error: `Could not assign ${role} to restaurant` }, 500);
        }
      }

      return json({ user: { id: created.id, email, role } }, 201);
    }

    if (body.action === "update-driver") {
      const userId = String(body.userId || "");
      const restaurantId = String(body.restaurantId || "");
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const phone = body.phone ? String(body.phone).trim() : null;
      const password = String(body.password || "");
      const isActive = body.isActive !== false;

      if (callerRole !== "admin" && callerRole !== "restaurant_owner") {
        return json({ error: "Driver update access denied" }, 403);
      }
      if (!userId || !restaurantId || !email || !fullName || (password && password.length < 6)) {
        return json({ error: "Invalid driver data" }, 400);
      }

      const assignmentResponse = await fetch(
        `${supabaseUrl}/rest/v1/restaurant_drivers?restaurant_id=eq.${restaurantId}&driver_id=eq.${userId}&select=driver_id,driver:profiles!restaurant_drivers_driver_id_fkey(role)`,
        { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
      );
      const assignments = assignmentResponse.ok ? await assignmentResponse.json() : [];
      if (!assignments.length || assignments[0]?.driver?.role !== "driver") {
        return json({ error: "Driver is not assigned to this restaurant" }, 404);
      }

      if (callerRole === "restaurant_owner") {
        const ownershipResponse = await fetch(
          `${supabaseUrl}/rest/v1/restaurants?id=eq.${restaurantId}&owner_id=eq.${caller.id}&select=id`,
          { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
        );
        const ownedRestaurants = ownershipResponse.ok ? await ownershipResponse.json() : [];
        if (!ownedRestaurants.length) return json({ error: "Restaurant access denied" }, 403);
      }

      const authUpdate: Record<string, unknown> = {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      };
      if (password) authUpdate.password = password;

      const authUpdateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify(authUpdate),
      });
      if (!authUpdateResponse.ok) {
        const authError = await authUpdateResponse.json();
        return json({ error: authError.message || authError }, authUpdateResponse.status);
      }

      const profileUpdateResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email, full_name: fullName, phone, updated_at: new Date().toISOString() }),
      });
      if (!profileUpdateResponse.ok) return json({ error: "Could not update driver profile" }, 500);

      const assignmentUpdateResponse = await fetch(
        `${supabaseUrl}/rest/v1/restaurant_drivers?restaurant_id=eq.${restaurantId}&driver_id=eq.${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ is_active: isActive }),
        },
      );
      if (!assignmentUpdateResponse.ok) return json({ error: "Could not update driver assignment" }, 500);

      return json({ success: true });
    }

    if (body.action === "update-waiter") {
      const userId = String(body.userId || "");
      const restaurantId = String(body.restaurantId || "");
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const phone = body.phone ? String(body.phone).trim() : null;
      const password = String(body.password || "");
      const isActive = body.isActive !== false;

      if (callerRole !== "admin" && callerRole !== "restaurant_owner") {
        return json({ error: "Waiter update access denied" }, 403);
      }
      if (!userId || !restaurantId || !email || !fullName || (password && password.length < 6)) {
        return json({ error: "Invalid waiter data" }, 400);
      }

      const assignmentResponse = await fetch(
        `${supabaseUrl}/rest/v1/restaurant_waiters?restaurant_id=eq.${restaurantId}&waiter_id=eq.${userId}&select=waiter_id,waiter:profiles!restaurant_waiters_waiter_id_fkey(role)`,
        { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
      );
      const assignments = assignmentResponse.ok ? await assignmentResponse.json() : [];
      if (!assignments.length || assignments[0]?.waiter?.role !== "waiter") {
        return json({ error: "Waiter is not assigned to this restaurant" }, 404);
      }

      if (callerRole === "restaurant_owner") {
        const ownershipResponse = await fetch(
          `${supabaseUrl}/rest/v1/restaurants?id=eq.${restaurantId}&owner_id=eq.${caller.id}&select=id`,
          { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
        );
        const ownedRestaurants = ownershipResponse.ok ? await ownershipResponse.json() : [];
        if (!ownedRestaurants.length) return json({ error: "Restaurant access denied" }, 403);
      }

      const authUpdate: Record<string, unknown> = {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      };
      if (password) authUpdate.password = password;

      const authUpdateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify(authUpdate),
      });
      if (!authUpdateResponse.ok) {
        const authError = await authUpdateResponse.json();
        return json({ error: authError.message || authError }, authUpdateResponse.status);
      }

      const profileUpdateResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ email, full_name: fullName, phone, updated_at: new Date().toISOString() }),
      });
      if (!profileUpdateResponse.ok) return json({ error: "Could not update waiter profile" }, 500);

      const assignmentUpdateResponse = await fetch(
        `${supabaseUrl}/rest/v1/restaurant_waiters?restaurant_id=eq.${restaurantId}&waiter_id=eq.${userId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ is_active: isActive }),
        },
      );
      if (!assignmentUpdateResponse.ok) return json({ error: "Could not update waiter assignment" }, 500);

      return json({ success: true });
    }

    if (body.action === "delete") {
      if (callerRole !== "admin") return json({ error: "Admin access required" }, 403);
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "User id is required" }, 400);
      if (userId === caller.id) return json({ error: "You cannot delete your own account" }, 400);

      const targetResponse = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=email`,
        { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } },
      );
      const targets = targetResponse.ok ? await targetResponse.json() : [];
      if (targets[0]?.email?.toLowerCase() === "admin@admin.com") {
        return json({ error: "The bootstrap administrator cannot be deleted" }, 400);
      }

      const deleteResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
      });
      if (!deleteResponse.ok) {
        const error = await deleteResponse.json();
        return json({ error: error.message || error }, deleteResponse.status);
      }

      return json({ success: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
