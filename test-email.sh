#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Azoir — End-to-end email test (bypasses Shopify webhook)
# Usage: bash test-email.sh <PROCESS_JOB_SECRET>
# ─────────────────────────────────────────────────────────────────────────────

set -e

SUPABASE_URL="https://avmcksqllodvspbtcmgf.supabase.co"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2bWNrc3FsbG9kdnNwYnRjbWdmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAwMzY1MSwiZXhwIjoyMDg4NTc5NjUxfQ.0GLJ0nmfM49WnFE-qar4FAUCDsW55i0w4-h8__-jmHI"
PROCESS_JOB_SECRET="${1:?Usage: bash test-email.sh <PROCESS_JOB_SECRET>}"
PROCESS_JOB_URL="$SUPABASE_URL/functions/v1/process-job"

AUTH="-H \"apikey: $SERVICE_ROLE_KEY\" -H \"Authorization: Bearer $SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\""

echo ""
echo "=== Azoir Email Test ==="
echo ""

# ── Step 1: Submit a real test quote ─────────────────────────────────────────
echo "1. Submitting test quote..."
QUOTE_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/quote-submit" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Test Customer",
    "email": "gelek@azoir.co",
    "phone": "+61400000000",
    "country": "AU",
    "contact_method": "email",
    "metal": "18ct Yellow Gold",
    "stones": "Round brilliant diamond, approx 1ct",
    "notes": "Email delivery test — please ignore. Looking for a solitaire engagement ring with a classic cathedral setting."
  }')

QUOTE_ID=$(echo "$QUOTE_RESPONSE" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$QUOTE_ID" ]; then
  echo "ERROR: Failed to create quote. Response: $QUOTE_RESPONSE"
  exit 1
fi
echo "   Quote created: $QUOTE_ID"

# ── Step 2: Insert a fake payment record ──────────────────────────────────────
echo "2. Inserting test payment..."
PAYMENT_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/rest/v1/payments" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"quote_request_id\": \"$QUOTE_ID\",
    \"shopify_order_id\": \"TEST-$(date +%s)\",
    \"shopify_order_name\": \"#TEST001\",
    \"amount\": 59,
    \"currency\": \"AUD\",
    \"status\": \"captured\"
  }")

PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PAYMENT_ID" ]; then
  echo "ERROR: Failed to create payment. Response: $PAYMENT_RESPONSE"
  exit 1
fi
echo "   Payment created: $PAYMENT_ID"

# ── Step 3: Insert a job record ───────────────────────────────────────────────
echo "3. Inserting test job..."
JOB_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/rest/v1/jobs" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{
    \"payment_id\": \"$PAYMENT_ID\",
    \"quote_request_id\": \"$QUOTE_ID\",
    \"status\": \"new\"
  }")

JOB_ID=$(echo "$JOB_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
JOB_REF=$(echo "$JOB_RESPONSE" | grep -o '"job_ref":"[^"]*"' | cut -d'"' -f4)

if [ -z "$JOB_ID" ]; then
  echo "ERROR: Failed to create job. Response: $JOB_RESPONSE"
  exit 1
fi
echo "   Job created: $JOB_REF ($JOB_ID)"

# ── Step 4: Trigger process-job ───────────────────────────────────────────────
echo "4. Triggering process-job..."
PROCESS_RESPONSE=$(curl -s -X POST "$PROCESS_JOB_URL" \
  -H "Content-Type: application/json" \
  -H "x-azoir-secret: $PROCESS_JOB_SECRET" \
  -d "{\"payment_id\": \"$PAYMENT_ID\"}")

echo "   Response: $PROCESS_RESPONSE"

if echo "$PROCESS_RESPONSE" | grep -q "processing started"; then
  echo ""
  echo "SUCCESS — job $JOB_REF is processing."
  echo "Check gelek@azoir.co for:"
  echo "  - Internal job sheet: [NEW JOB] $JOB_REF — Design Fee Received"
  echo "  - Customer confirmation: Your design journey begins — $JOB_REF"
  echo ""
  echo "If no email arrives in 60s, check Supabase → Table Editor → notifications"
  echo "for error_message details."
else
  echo ""
  echo "ERROR — process-job did not accept the request."
  echo "Check your PROCESS_JOB_SECRET is correct."
fi
