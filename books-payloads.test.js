import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPaidPatch, latePaymentPatch, latePaymentPath, BOOKS_FLOW_MODES, RETAIL_FLOW_MODES, paymentIntentMetadataParams, inquiryPaymentFields } from "./books-payloads.js";

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
test("only writes while both are empty", () => assert.equal(latePaymentPath("b1"), "band_orders?id=eq.b1&status=eq.cancelled&late_paid_cents=is.null&late_payment_intent=is.null"));

const ID = "3f6c1a2e-1111-4222-8333-444455556666";
test("names Azoir as the entity", () => assert.equal(paymentIntentMetadataParams("band_deposit", "b1")["payment_intent_data[metadata][entity]"], "azoir"));
test("names the source", () => assert.equal(paymentIntentMetadataParams("azoir_inquiry_fee", ID)["payment_intent_data[metadata][source_id]"], ID));
test("sends only modes Books knows", () => assert.equal(RETAIL_FLOW_MODES.every((m) => BOOKS_FLOW_MODES.includes(m)), true));
test("refuses a session-level mode", () => assert.throws(() => paymentIntentMetadataParams("azoir_band", "b1"), /unknown books mode/));
test("uses the minted inquiry id", () => assert.equal(inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9" }).id, ID));
test("stores the PaymentIntent", () => assert.equal(inquiryPaymentFields({ metadata: { inquiry_id: ID }, payment_intent: "pi_9" }).stripe_payment_intent, "pi_9"));
test("ignores a malformed inquiry id", () => assert.equal("id" in inquiryPaymentFields({ metadata: { inquiry_id: "x" }, payment_intent: "pi_9" }), false));
