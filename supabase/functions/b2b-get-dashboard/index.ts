// Azoir — b2b-get-dashboard Edge Function
// Returns all B2B orders for the logged-in customer.
// Deploy: npx supabase functions deploy b2b-get-dashboard --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type, x-customer-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  // Customer ID passed as header from Liquid ({{ customer.id }})
  const customerId = req.headers.get("x-customer-id");
  if (!customerId) return json({ success: false, error: "x-customer-id header required" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch registration
  const { data: reg } = await supabase
    .from("b2b_registrations")
    .select("id, status, company_name, contact_name, email, business_type, country, website")
    .eq("shopify_customer_id", customerId)
    .maybeSingle();

  // Fetch orders
  const { data: orders, error } = await supabase
    .from("b2b_orders")
    .select("id, created_at, updated_at, company_name, metal, stones, po_number, quantity, deadline_at, status, design_fee_status, design_fee_amount, shopify_order_name, tracking_number, tracking_carrier, shipped_at")
    .eq("shopify_customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("DB error:", error);
    return json({ success: false, error: "Failed to fetch orders" }, 500);
  }

  // Fetch status history for each order
  const orderIds = (orders ?? []).map((o: Record<string, unknown>) => o.id);
  let historyMap: Record<string, unknown[]> = {};

  if (orderIds.length > 0) {
    const { data: history } = await supabase
      .from("b2b_status_history")
      .select("b2b_order_id, to_status, created_at, note")
      .in("b2b_order_id", orderIds)
      .order("created_at", { ascending: true });

    for (const row of history ?? []) {
      const r = row as Record<string, unknown>;
      const id = r.b2b_order_id as string;
      if (!historyMap[id]) historyMap[id] = [];
      historyMap[id].push(r);
    }
  }

  const ordersWithHistory = (orders ?? []).map((o: Record<string, unknown>) => ({
    ...o,
    status_history: historyMap[o.id as string] ?? [],
  }));

  return json({ success: true, registration: reg ?? null, orders: ordersWithHistory }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
