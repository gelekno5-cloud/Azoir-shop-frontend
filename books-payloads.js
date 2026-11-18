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
