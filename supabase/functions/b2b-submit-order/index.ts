// Azoir — b2b-submit-order Edge Function
// Receives B2B commission form POST, saves to b2b_orders.
// Deploy: npx supabase functions deploy b2b-submit-order --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const shopify_customer_id = sanitize(body.shopify_customer_id);
  const contact_name        = sanitize(body.contact_name);
  const company_name        = sanitize(body.company_name);
  const email               = sanitize(body.email);

  if (!shopify_customer_id) return json({ success: false, error: "shopify_customer_id is required" }, 422);
  if (!contact_name)        return json({ success: false, error: "contact_name is required" }, 422);
  if (!company_name)        return json({ success: false, error: "company_name is required" }, 422);
  if (!email || !isValidEmail(email)) return json({ success: false, error: "Valid email is required" }, 422);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Parse reference_image_urls — comma-separated string or array
  let reference_image_urls: string[] = [];
  if (typeof body.reference_image_urls === "string" && body.reference_image_urls.trim()) {
    reference_image_urls = body.reference_image_urls.split(",").map((u: string) => u.trim()).filter(Boolean);
  } else if (Array.isArray(body.reference_image_urls)) {
    reference_image_urls = body.reference_image_urls.filter((u): u is string => typeof u === "string");
  }

  // Parse quantity
  const quantityRaw = body.quantity;
  const quantity     = typeof quantityRaw === "number"
    ? Math.max(1, Math.floor(quantityRaw))
    : parseInt(String(quantityRaw ?? "1"), 10) || 1;

  const row = {
    shopify_customer_id,
    contact_name,
    company_name,
    email,
    phone:                sanitize(body.phone)          ?? null,
    country:              sanitize(body.country)        ?? null,
    contact_method:       sanitize(body.contact_method) ?? null,
    metal:                sanitize(body.metal)          ?? null,
    stones:               sanitize(body.stones)         ?? null,
    notes:                sanitize(body.notes)          ?? null,
    reference_image_urls: reference_image_urls.length > 0 ? reference_image_urls : null,
    po_number:            sanitize(body.po_number)      ?? null,
    quantity,
    deadline_at:          sanitize(body.deadline_at)    ?? null,
    design_fee_amount:    90.00,
    design_fee_status:    "pending",
    status:               "pending_payment",
  };

  const { data, error } = await supabase
    .from("b2b_orders")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("DB insert error:", error);
    return json({ success: false, error: "Failed to save order. Please try again." }, 500);
  }

  return json({ success: true, order_id: data.id }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.trim().slice(0, 5000) || undefined;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
