// Payload builders for the server. No I/O of their own (recordLateBandPayment is handed its I/O),
// so they can be tested without server.js (which listens on import).

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
    late_paid_cents: Number.isFinite(session.amount_total) ? session.amount_total : null,
    late_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    updated_at: nowIso,
  };
}

/**
 * Compare-and-set filter: matches only a cancelled request that was never paid and whose late
 * payment is not yet recorded. A deposit paid on time, then refunded and cancelled, keeps
 * paid_at and stripe_payment_intent: a replay of its session must not record it a second time.
 */
export const latePaymentPath = (id) => `band_orders?id=eq.${id}&status=eq.cancelled&paid_at=is.null&stripe_payment_intent=is.null&late_paid_cents=is.null&late_payment_intent=is.null`;

/** Whether a request whose paid compare-and-set missed (`cur` = status, paid_at, stripe_payment_intent) was paid after cancellation. */
export const isLatePayment = (cur) => !!cur && cur.status === "cancelled" && !cur.paid_at && !cur.stripe_payment_intent;

/**
 * Record a deposit paid after cancellation, once, and tell the admin. `io` is { sb, event }
 * (server.js's Supabase call and bandEvent). When the notice can't be sent the late columns are
 * undone and the error rethrown, so the webhook answers 500 and Stripe's retry tells the admin;
 * otherwise the retry would find the columns set and stay silent about money to refund.
 * Returns "late", or "already" when an earlier delivery recorded it.
 */
export async function recordLateBandPayment({ id, orderNumber, session, nowIso }, io) {
  const patch = latePaymentPatch(session, nowIso);
  const late = await io.sb(latePaymentPath(id), { method: "PATCH", body: patch, prefer: "return=representation" });
  if (!late || late.length === 0) return "already";
  const pi = patch.late_payment_intent;
  try {
    await io.sb("b2b_admin_notifications", { method: "POST", body: { type: "band_order", message: `Band request ${orderNumber} was paid after it was cancelled (${pi}) — refund it from the Stripe dashboard (the request was never marked paid, so /app/band-orders can't refund it).` } });
  } catch (e) {
    const undo = pi ? `band_orders?id=eq.${id}&late_payment_intent=eq.${pi}`
      : patch.late_paid_cents != null ? `band_orders?id=eq.${id}&late_payment_intent=is.null&late_paid_cents=eq.${patch.late_paid_cents}` : null;
    if (undo) await io.sb(undo, { method: "PATCH", body: { late_paid_cents: null, late_payment_intent: null } }).catch((u) => console.error("[band] late payment undo failed", u.message));
    throw e;
  }
  await io.event(id, "paid", "stripe", { note: "Deposit paid after the request was cancelled — refund due", data: { payment_intent: pi, amount_total: session.amount_total } });
  return "late";
}

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
