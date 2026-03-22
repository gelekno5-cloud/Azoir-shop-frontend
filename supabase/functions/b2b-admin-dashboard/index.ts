// Azoir — b2b-admin-dashboard Edge Function
// Returns all B2B registrations (with latest order counts) for the admin UI.
// Deploy: npx supabase functions deploy b2b-admin-dashboard --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ADMIN_SECRET = Deno.env.get("ADMIN_ACTION_SECRET") ?? "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  const secret = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const url    = new URL(req.url);
  const type   = url.searchParams.get("type") ?? "registrations"; // "registrations" | "orders"
  const status = url.searchParams.get("status");
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Orders view ───────────────────────────────────────────────────────────
  if (type === "orders") {
    let query = supabase
      .from("b2b_orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;

    if (error) {
      console.error("DB error:", error);
      return json({ success: false, error: "Failed to fetch orders" }, 500);
    }

    return json({ success: true, orders: data ?? [], total: count ?? 0 }, 200);
  }

  // ── Registrations view (default) ──────────────────────────────────────────
  let query = supabase
    .from("b2b_registrations")
    .select("*, b2b_orders(id)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;

  if (error) {
    console.error("DB error:", error);
    return json({ success: false, error: "Failed to fetch registrations" }, 500);
  }

  const registrations = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    order_count: Array.isArray(r.b2b_orders) ? r.b2b_orders.length : 0,
    b2b_orders: undefined,
  }));

  return json({ success: true, registrations, total: count ?? 0 }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
