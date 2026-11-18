// Pure payload builders for the server. No I/O, so they can be tested without server.js (which listens on import).

export const BAND_DEPOSIT_MIN_CENTS = 25000;                  // $250 floor, and the flat deposit when there is no estimate
export const BAND_DEPOSIT_RATE = 0.25;                        // of the estimate (owner, 2026-10-17)
export const bandDepositCents = (estimateCents) => estimateCents == null ? BAND_DEPOSIT_MIN_CENTS : Math.max(BAND_DEPOSIT_MIN_CENTS, Math.round(estimateCents * BAND_DEPOSIT_RATE));

/** The deposit terms of a saved request, from spec.deposit (written by /band-request) with safe fallbacks. */
export function bandDepositOf(order) {
  const d = (order.spec && order.spec.deposit) || {};
  const quoteNeeded = !!d.quoteNeeded;
  const estimateCents = quoteNeeded ? null : Number.isFinite(d.estimateCents) ? d.estimateCents : order.subtotal_cents + (order.shipping_cents || 0);
  const depositCents = Number.isFinite(d.depositCents) ? d.depositCents : bandDepositCents(estimateCents);
  return { quoteNeeded, estimateCents, depositCents, balanceCents: estimateCents == null ? null : Math.max(0, estimateCents - depositCents), notes: typeof d.notes === "string" ? d.notes : "" };
}

/**
 * Everything a paid deposit writes to band_orders, in one PATCH: the status, what Stripe charged,
 * the tax inside that charge, and the balance. `order` is { spec, subtotal_cents, shipping_cents }.
 * Keys left undefined are dropped by JSON.stringify, so the form's name/email/phone stay unless
 * Stripe collected something.
 */
export function bandPaidPatch(session, order, nowIso) {
  const cd = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  const dep = bandDepositOf(order);
  return {
    status: "deposit_paid", paid_at: nowIso, updated_at: nowIso,
    stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    stripe_checkout_session_id: session.id,
    deposit_cents: Number.isFinite(session.amount_total) ? session.amount_total : dep.depositCents,
    balance_cents: dep.balanceCents,
    quote_needed: dep.quoteNeeded,
    deposit_tax_cents: session.total_details?.amount_tax ?? 0,
    email: cd.email || undefined, customer_name: (shipping && shipping.name) || cd.name || undefined, phone: cd.phone || undefined,
    ship_to: shipping ? { name: shipping.name || null, address: shipping.address || null } : undefined,
  };
}

/** A deposit paid after the admin cancelled the request: the money columns the refund is worked from. */
export function latePaymentPatch(session, nowIso) {
  return {
    late_paid_cents: session.amount_total,
    late_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    updated_at: nowIso,
  };
}

/** Compare-and-set filter: matches only a cancelled request whose late payment is not yet recorded. */
export const latePaymentPath = (id) => `band_orders?id=eq.${id}&status=eq.cancelled&late_paid_cents=is.null&late_payment_intent=is.null`;

// The flow modes Books (Moksh OS, app/books/lib/payment-metadata.ts) reads off a PaymentIntent's
// metadata. A copy: change both together.
export const BOOKS_FLOW_MODES = ["invoice", "statement", "design_fee", "stock_order", "azoir_inquiry_fee", "retail_milestone", "band_deposit", "band_balance"];
/** The modes this server sends. Distinct from the session-level metadata[mode] (FEE_MODE, BAND_MODE in server.js). */
export const RETAIL_FLOW_MODES = ["azoir_inquiry_fee", "band_deposit"];

/** Checkout Session params that stamp entity/mode/source_id on the PaymentIntent, for Books to attribute the charge. */
export function paymentIntentMetadataParams(mode, sourceId) {
  if (!RETAIL_FLOW_MODES.includes(mode)) throw new Error("unknown books mode " + mode);
  return {
    "payment_intent_data[metadata][entity]": "azoir",
    "payment_intent_data[metadata][mode]": mode,
    "payment_intent_data[metadata][source_id]": sourceId,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The retail_inquiries columns a paid session decides: the id minted at /inquiry (when valid) and the PaymentIntent. */
export function inquiryPaymentFields(session) {
  const id = session.metadata?.inquiry_id;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  return { ...(UUID_RE.test(String(id || "")) ? { id } : {}), stripe_payment_intent: pi };
}
