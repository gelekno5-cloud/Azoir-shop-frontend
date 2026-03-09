// ─────────────────────────────────────────────────────────────────────────────
// Azoir — shared TypeScript types for Edge Functions
// ─────────────────────────────────────────────────────────────────────────────

export interface QuoteRequest {
  id: string;
  created_at: string;
  customer_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  contact_method: string | null; // 'email' | 'sms' | 'whatsapp'
  notes: string | null;
  metal: string | null;
  stones: string | null;
  reference_links: string | null;
  status: string;
  design_fee_amount: number | null;
  design_fee_status: string;
}

export interface Payment {
  id: string;
  created_at: string;
  quote_request_id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  amount: number;
  currency: string;
  status: string;
}

export interface Job {
  id: string;
  created_at: string;
  payment_id: string;
  quote_request_id: string;
  job_ref: string;
  status: string;
}

// Shopify order webhook payload (simplified — only fields we need)
export interface ShopifyOrder {
  id: number;
  name: string;          // "#1001"
  email: string;
  total_price: string;   // "59.00"
  currency: string;
  financial_status: string;
  line_items: ShopifyLineItem[];
  note_attributes: ShopifyNoteAttribute[];
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
}

export interface ShopifyLineItem {
  id: number;
  product_id: number;
  variant_id: number;
  title: string;
  quantity: number;
  price: string;
  properties: ShopifyProperty[];
}

export interface ShopifyProperty {
  name: string;
  value: string;
}

export interface ShopifyNoteAttribute {
  name: string;
  value: string;
}

export interface AiOutput {
  content: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
}

export type NotificationChannel = "email" | "sms" | "whatsapp";
