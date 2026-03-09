// Azoir Commission — quote-submit Edge Function
// Deploy: supabase functions deploy quote-submit --no-verify-jwt
//
// Environment variable required (set in Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_SERVICE_ROLE_KEY  — your project's service role key

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  // Validate required fields
  const name  = sanitize(body.customer_name);
  const email = sanitize(body.email);
  if (!name)  return json({ success: false, error: "customer_name is required" }, 422);
  if (!email) return json({ success: false, error: "email is required" }, 422);
  if (!isValidEmail(email)) return json({ success: false, error: "Invalid email address" }, 422);

  // Build row
  const row = {
    customer_name:   name,
    email:           email,
    phone:           sanitize(body.phone)           ?? null,
    country:         sanitize(body.country)         ?? null,
    contact_method:  sanitize(body.contact_method)  ?? null,
    notes:           sanitize(body.notes)           ?? null,
    metal:           sanitize(body.metal)           ?? null,
    stones:          sanitize(body.stones)          ?? null,
    reference_links: sanitize(body.reference_links) ?? null,
  };

  // Supabase client (service role — server-side only)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("quote_requests")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("DB insert error:", error);
    return json({ success: false, error: "Failed to save request. Please try again." }, 500);
  }

  return json({ success: true, request_id: data.id }, 200);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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
