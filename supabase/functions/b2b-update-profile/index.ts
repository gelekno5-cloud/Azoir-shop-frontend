// Azoir — b2b-update-profile Edge Function
// Allows approved B2B customers to update their registration profile.
// Deploy: npx supabase functions deploy b2b-update-profile --no-verify-jwt

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
  if (!shopify_customer_id) return json({ success: false, error: "shopify_customer_id is required" }, 422);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify registration exists and belongs to this customer
  const { data: reg } = await supabase
    .from("b2b_registrations")
    .select("id, status")
    .eq("shopify_customer_id", shopify_customer_id)
    .maybeSingle();

  if (!reg) return json({ success: false, error: "No registration found" }, 404);

  // Only allow editing certain fields — not status, reviewed_by, etc.
  const updates: Record<string, string | null> = {};
  const editable = ["contact_name", "company_name", "email", "phone", "website", "country", "tax_id"];

  for (const field of editable) {
    if (field in body) {
      updates[field] = sanitize(body[field]) ?? null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ success: false, error: "No valid fields to update" }, 422);
  }

  const { error } = await supabase
    .from("b2b_registrations")
    .update(updates)
    .eq("id", reg.id);

  if (error) {
    console.error("DB update error:", error);
    return json({ success: false, error: "Failed to update profile" }, 500);
  }

  return json({ success: true }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.trim().slice(0, 1000) || undefined;
}
