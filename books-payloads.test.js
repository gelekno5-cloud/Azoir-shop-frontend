import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPaidPatch, latePaymentPatch, latePaymentPath, isLatePayment, recordLateBandPayment, BOOKS_FLOW_MODES, RETAIL_FLOW_MODES, paymentIntentMetadataParams, inquiryPaymentFields, inquiryTaxParams } from "./books-payloads.js";

const ORDER = { spec: { deposit: { estimateCents: 200000, depositCents: 50000 } }, subtotal_cents: 190000, shipping_cents: 10000 };
const SESSION = { id: "cs_1", payment_intent: "pi_1", amount_total: 54438, total_details: { amount_tax: 4438 }, customer_details: {} };
const p = bandPaidPatch(SESSION, ORDER, "2026-11-20T15:00:00.000Z");

test("marks the deposit paid", () => assert.equal(p.status, "deposit_paid"));
test("writes what Stripe charged as the deposit", () => assert.equal(p.deposit_cents, 54438));
test("writes the deposit's tax in the same PATCH", () => assert.equal(p.deposit_tax_cents, 4438));
test("writes the balance in the same PATCH", () => assert.equal(p.balance_cents, 150000));
test("reads a session with no tax as zero tax", () => assert.equal(bandPaidPatch({ ...SESSION, total_details: undefined }, ORDER, "x").deposit_tax_cents, 0));

test("records the late amount", () => assert.equal(latePaymentPatch(SESSION, "t").late_paid_cents, 54438));
test("records the late PaymentIntent", () => assert.equal(latePaymentPatch(SESSION, "t").late_payment_intent, "pi_1"));
test("only writes while both are empty", () => assert.equal(latePaymentPath("b1").includes("&late_paid_cents=is.null&late_payment_intent=is.null"), true));
// A deposit paid on time, then refunded and cancelled, is not a late payment: its replay must not record it again.
test("only writes on a request that was never paid", () => assert.equal(latePaymentPath("b1").includes("&paid_at=is.null&stripe_payment_intent=is.null"), true));
test("records no late amount when Stripe sent none", () => assert.equal(latePaymentPatch({ ...SESSION, amount_total: undefined }, "t").late_paid_cents, null));

test("a cancelled request never paid is a late payment", () => assert.equal(isLatePayment({ status: "cancelled", paid_at: null, stripe_payment_intent: null }), true));
test("a paid request later cancelled is not a late payment", () => assert.equal(isLatePayment({ status: "cancelled", paid_at: "2026-11-01T00:00:00Z", stripe_payment_intent: "pi_1" }), false));
test("a delivered request is not a late payment", () => assert.equal(isLatePayment({ status: "deposit_paid", paid_at: "2026-11-01T00:00:00Z", stripe_payment_intent: "pi_1" }), false));
test("a missing request is not a late payment", () => assert.equal(isLatePayment(undefined), false));

/** A fake sb: answers each call with the next scripted result (a value, or an Error to throw), and records it. */
function fakeIo(...answers) {
  const calls = [], events = [];
  return {
    calls, events,
    sb: async (path, opts = {}) => { calls.push({ path, ...opts }); const a = answers.shift(); if (a instanceof Error) throw a; return a; },
    event: async (...args) => { events.push(args); },
  };
}
const LATE = { id: "b1", orderNumber: "AZ-B-0001", session: SESSION, nowIso: "t" };

test("tells the admin about a late payment", async () => {
  const io = fakeIo([{ id: "b1" }], null);
  await recordLateBandPayment(LATE, io);
  assert.equal(io.calls[1].path, "b2b_admin_notifications");
});
test("logs the late payment on the timeline", async () => {
  const io = fakeIo([{ id: "b1" }], null);
  await recordLateBandPayment(LATE, io);
  assert.equal(io.events.length, 1);
});
test("tells nobody when the late payment is already recorded", async () => {
  const io = fakeIo([]);
  await recordLateBandPayment(LATE, io);
  assert.equal(io.calls.length, 1);
});
// The webhook's retry finds the columns set and stays silent, so a failed notice must undo them.
test("fails the delivery when the admin can't be told", async () => {
  const io = fakeIo([{ id: "b1" }], new Error("supabase 503"), null);
  await assert.rejects(recordLateBandPayment(LATE, io), /supabase 503/);
});
test("undoes the late columns when the admin can't be told", async () => {
  const io = fakeIo([{ id: "b1" }], new Error("supabase 503"), null);
  await recordLateBandPayment(LATE, io).catch(() => {});
  assert.deepEqual([io.calls[2].path, io.calls[2].body], ["band_orders?id=eq.b1&late_payment_intent=eq.pi_1", { late_paid_cents: null, late_payment_intent: null }]);
});
test("logs nothing when the admin can't be told", async () => {
  const io = fakeIo([{ id: "b1" }], new Error("supabase 503"), null);
  await recordLateBandPayment(LATE, io).catch(() => {});
  assert.equal(io.events.length, 0);
});

const ID = "3f6c1a2e-1111-4222-8333-444455556666";
test("names Azoir as the entity", () => assert.equal(paymentIntentMetadataParams("band_deposit", "b1")["payment_intent_data[metadata][entity]"], "azoir"));
test("names the source", () => assert.equal(paymentIntentMetadataParams("azoir_inquiry_fee", ID)["payment_intent_data[metadata][source_id]"], ID));
test("sends only modes Books knows", () => assert.equal(RETAIL_FLOW_MODES.every((m) => BOOKS_FLOW_MODES.includes(m)), true));
test("refuses a session-level mode", () => assert.throws(() => paymentIntentMetadataParams("azoir_band", "b1"), /unknown books mode/));
test("uses the minted inquiry id", () => assert.equal(inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9" }).id, ID));
test("stores the PaymentIntent", () => assert.equal(inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9" }).stripe_payment_intent, "pi_9"));
test("ignores a malformed inquiry id", () => assert.equal("id" in inquiryPaymentFields({ metadata: { inquiry_id: "x" }, payment_intent: "pi_9" }), false));

test("turns on Stripe Tax for the fee when the env says so", () => assert.equal(inquiryTaxParams({ INQUIRY_FEE_STRIPE_TAX: "1" })["automatic_tax[enabled]"], "true"));
test("asks for the billing address the fee is taxed at", () => assert.equal(inquiryTaxParams({ INQUIRY_FEE_STRIPE_TAX: "1" }).billing_address_collection, "required"));
test("adds the fee's tax on top of the $60", () => assert.equal(inquiryTaxParams({ INQUIRY_FEE_STRIPE_TAX: "1" })["line_items[0][price_data][tax_behavior]"], "exclusive"));
test("leaves the fee untaxed without the env", () => assert.deepEqual(inquiryTaxParams({}), {}));
test("leaves the fee untaxed for any other env value", () => assert.deepEqual(inquiryTaxParams({ INQUIRY_FEE_STRIPE_TAX: "true" }), {}));
test("stores the fee's tax", () => assert.equal(inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9", total_details: { amount_tax: 533 } }).design_fee_tax_cents, 533));
// The column defaults to 0: leaving it out keeps an untaxed inquiry inserting before -inquiry-fee-tax runs.
test("writes no tax column for an untaxed fee", () => assert.equal("design_fee_tax_cents" in inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9", total_details: { amount_tax: 0 } }), false));
test("writes no tax column when Stripe sent no totals", () => assert.equal("design_fee_tax_cents" in inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9" }), false));
