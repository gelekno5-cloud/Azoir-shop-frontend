// Azoir — b2b-upload-cert Edge Function
// Accepts a PDF file upload and stores it in the b2b-documents storage bucket.
// Deploy: npx supabase functions deploy b2b-upload-cert --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";
const MAX_FILE_SIZE   = 10 * 1024 * 1024; // 10 MB

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ success: false, error: "Expected multipart/form-data" }, 400);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ success: false, error: "Failed to parse form data" }, 400);
  }

  const shopifyCustomerId = formData.get("shopify_customer_id");
  const file              = formData.get("file");

  if (!shopifyCustomerId || typeof shopifyCustomerId !== "string") {
    return json({ success: false, error: "shopify_customer_id is required" }, 422);
  }
  if (!file || !(file instanceof File)) {
    return json({ success: false, error: "file is required" }, 422);
  }

  // Validate file type
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return json({ success: false, error: "Only PDF, JPG, PNG, or WEBP files are accepted" }, 422);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return json({ success: false, error: "File must be under 10 MB" }, 422);
  }

  const ext      = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const filename = `${shopifyCustomerId}/${Date.now()}.${ext}`;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const arrayBuffer = await file.arrayBuffer();

  const { error } = await supabase.storage
    .from("b2b-documents")
    .upload(filename, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    console.error("Storage upload error:", error);
    return json({ success: false, error: "Failed to upload file. Please try again." }, 500);
  }

  return json({ success: true, path: filename }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
