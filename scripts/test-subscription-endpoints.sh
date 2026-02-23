#!/usr/bin/env bash
# ============================================================
# Quezia — Subscription & SubscriptionPack endpoint smoke test
# ============================================================

BASE="http://localhost:3000"
PASS=0
FAIL=0

# ---- helpers ------------------------------------------------
green() { printf "\033[32m✔  %s\033[0m\n" "$*"; }
red()   { printf "\033[31m✘  %s\033[0m\n" "$*"; }
blue()  { printf "\033[34m\n▶  %s\033[0m\n" "$*"; }
dim()   { printf "\033[90m   %s\033[0m\n"  "$*"; }

assert_status() {
  local label="$1" expected="$2" actual="$3" body="$4"
  if [[ "$actual" == "$expected" ]]; then
    green "$label (HTTP $actual)"
    PASS=$((PASS+1))
  else
    red "$label — expected HTTP $expected, got $actual"
    dim "$body"
    FAIL=$((FAIL+1))
  fi
}

assert_field() {
  local label="$1" field="$2" body="$3"
  if echo "$body" | grep -q "\"$field\""; then
    green "$label (field '$field' present)"
    PASS=$((PASS+1))
  else
    red "$label — field '$field' missing in response"
    dim "$body"
    FAIL=$((FAIL+1))
  fi
}

assert_value() {
  local label="$1" needle="$2" body="$3"
  if echo "$body" | grep -q "$needle"; then
    green "$label"
    PASS=$((PASS+1))
  else
    red "$label — expected '$needle' not found"
    dim "$body"
    FAIL=$((FAIL+1))
  fi
}

# ============================================================
# 0. Setup — unique identities + obtain tokens
# ============================================================
TS=$(date +%s)
EXAM_NAME="SUB_TEST_EXAM_${TS}"
LEARNER_EMAIL="learner_sub_${TS}@quezia.dev"
LEARNER_USERNAME="learner_sub_${TS}"
LEARNER2_EMAIL="learner_sub2_${TS}@quezia.dev"
LEARNER2_USERNAME="learner_sub2_${TS}"
LEARNER_PASS="Test@1234"
ADMIN_EMAIL="admin@quezia.com"
ADMIN_PASS="Admin123!"

echo ""
echo "============================================================"
echo " Quezia Subscription & Pack Endpoint Tests"
echo " Exam  : $EXAM_NAME"
echo " Time  : $(date)"
echo "============================================================"

# -- Admin login ----------------------------------------------
blue "0a. Admin login"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Admin login" 200 "$STATUS" "$BODY"
ADMIN_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
ADMIN_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -z "$ADMIN_TOKEN" ]]; then
  red "FATAL: Could not obtain admin token — is the server running and admin seeded?"
  dim "Run: npx ts-node -r tsconfig-paths/register scripts/create-admin.ts"
  exit 1
fi
dim "Admin ID: $ADMIN_ID"

# -- Learner 1 register ---------------------------------------
blue "0b. Learner register"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER_EMAIL\",\"username\":\"$LEARNER_USERNAME\",\"password\":\"$LEARNER_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner register" 201 "$STATUS" "$BODY"
LEARNER_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
LEARNER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Learner ID: $LEARNER_ID"

# -- Learner 2 register (for renewal test) --------------------
blue "0c. Learner 2 register (renewal test)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER2_EMAIL\",\"username\":\"$LEARNER2_USERNAME\",\"password\":\"$LEARNER_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner 2 register" 201 "$STATUS" "$BODY"
LEARNER2_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
LEARNER2_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Learner 2 ID: $LEARNER2_ID"

# -- Create exam (needed to link packs) ----------------------
blue "0d. Create test exam"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Subscription test exam\",\"isActive\":true}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam for subscription tests" 201 "$STATUS" "$BODY"
EXAM_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Exam ID: $EXAM_ID"

# ============================================================
# 1. CREATE SUBSCRIPTION PACK (admin)
# ============================================================
blue "1. POST /subscriptions/packs — create pack (admin)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/packs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"examId\": \"$EXAM_ID\",
    \"name\": \"30-Day Pass\",
    \"durationDays\": 30,
    \"price\": 2500,
    \"isActive\": true
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create subscription pack" 201 "$STATUS" "$BODY"
assert_field  "  pack has id" "id" "$BODY"
assert_field  "  pack has examId" "examId" "$BODY"
assert_field  "  pack has durationDays" "durationDays" "$BODY"
assert_field  "  pack has price" "price" "$BODY"
assert_field  "  pack has isActive" "isActive" "$BODY"
PACK_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Pack ID: $PACK_ID"

# ============================================================
# 2. CREATE PACK — invalid examId (should 404)
# ============================================================
blue "2. POST /subscriptions/packs — invalid examId (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/packs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"examId":"nonexistent-exam","name":"Bad Pack","durationDays":30,"price":100}')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create pack nonexistent exam → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 3. CREATE PACK — non-admin (should 403)
# ============================================================
blue "3. POST /subscriptions/packs — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/packs" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"examId\":\"$EXAM_ID\",\"name\":\"Rogue Pack\",\"durationDays\":7,\"price\":99}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create pack as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 4. CREATE PACK — unauthenticated (should 401)
# ============================================================
blue "4. POST /subscriptions/packs — no token (should 401)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/packs" \
  -H "Content-Type: application/json" \
  -d "{\"examId\":\"$EXAM_ID\",\"name\":\"Ghost Pack\",\"durationDays\":7,\"price\":99}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create pack unauthenticated → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 5. GET ALL PACKS
# ============================================================
blue "5. GET /subscriptions/packs"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/packs" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET all packs" 200 "$STATUS" "$BODY"
assert_value  "Response is an array" "\[" "$BODY"

# ============================================================
# 6. GET PACKS BY EXAM
# ============================================================
blue "6. GET /subscriptions/packs/exam/:examId"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/packs/exam/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET packs by exam" 200 "$STATUS" "$BODY"
assert_value  "  contains our pack" "$PACK_ID" "$BODY"

# ============================================================
# 7. GET PACK BY ID
# ============================================================
blue "7. GET /subscriptions/packs/:id"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/packs/$PACK_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET pack by id" 200 "$STATUS" "$BODY"
assert_field  "  pack has exam" "exam" "$BODY"

# ============================================================
# 8. GET PACK BY ID — not found
# ============================================================
blue "8. GET /subscriptions/packs/nonexistent (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/packs/nonexistent-pack-xyz" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET pack nonexistent → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 9. UPDATE PACK (admin)
# ============================================================
blue "9. PATCH /subscriptions/packs/:id — update price"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/subscriptions/packs/$PACK_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price":3000,"durationDays":45}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Update pack price + duration" 200 "$STATUS" "$BODY"
assert_value  "  durationDays updated" '"durationDays":45' "$BODY"

# ============================================================
# 10. TOGGLE PACK STATUS (admin) — disable then re-enable
# ============================================================
blue "10. PATCH /subscriptions/packs/:id/toggle — disable"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/subscriptions/packs/$PACK_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Toggle pack (disable)" 200 "$STATUS" "$BODY"
assert_value  "  isActive is false" '"isActive":false' "$BODY"

# Create a second active pack because we just disabled the first
blue "10b. Create second pack (for subscribe flow)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/packs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"examId\":\"$EXAM_ID\",\"name\":\"90-Day Pass\",\"durationDays\":90,\"price\":5000,\"isActive\":true}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create second active pack" 201 "$STATUS" "$BODY"
ACTIVE_PACK_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Active Pack ID: $ACTIVE_PACK_ID"

# ============================================================
# 11. SUBSCRIBE to inactive pack (should 400)
# ============================================================
blue "11. POST /subscriptions/subscribe — inactive pack (should 400)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/subscribe" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"packId\":\"$PACK_ID\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Subscribe to inactive pack → 400" 400 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 12. SUBSCRIBE — with active pack
# ============================================================
blue "12. POST /subscriptions/subscribe — active pack with payment ref"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/subscribe" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"packId\": \"$ACTIVE_PACK_ID\",
    \"paymentProvider\": \"paystack\",
    \"providerReference\": \"ps_ref_${TS}\"
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Subscribe to active pack" 201 "$STATUS" "$BODY"
assert_field  "  subscription has id" "id" "$BODY"
assert_field  "  subscription has status" "status" "$BODY"
assert_field  "  subscription has startedAt" "startedAt" "$BODY"
assert_field  "  subscription has expiresAt" "expiresAt" "$BODY"
assert_field  "  subscription has paymentProvider" "paymentProvider" "$BODY"
assert_value  "  status is ACTIVE" '"status":"ACTIVE"' "$BODY"
assert_value  "  providerReference stored" "ps_ref_${TS}" "$BODY"
SUB_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Subscription ID: $SUB_ID"

# ============================================================
# 13. RENEWAL — subscribe again to the same exam
#               old subscription should be CANCELLED, new one ACTIVE
# ============================================================
blue "13. POST /subscriptions/subscribe — renewal (cancels previous)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/subscribe" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"packId\":\"$ACTIVE_PACK_ID\",\"paymentProvider\":\"paystack\",\"providerReference\":\"ps_renewal_${TS}\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Renewal creates new subscription" 201 "$STATUS" "$BODY"
RENEWED_SUB_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Renewed Subscription ID: $RENEWED_SUB_ID"

# ============================================================
# 14. GET MY SUBSCRIPTIONS — should contain history
# ============================================================
blue "14. GET /subscriptions/my"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/my" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET my subscriptions" 200 "$STATUS" "$BODY"
assert_value  "  contains original sub ID" "$SUB_ID" "$BODY"
assert_value  "  contains renewed sub ID" "$RENEWED_SUB_ID" "$BODY"
assert_value  "  old sub is CANCELLED" '"status":"CANCELLED"' "$BODY"
assert_value  "  new sub is ACTIVE" '"status":"ACTIVE"' "$BODY"

# ============================================================
# 15. CHECK ACCESS — should have access to the exam now
# ============================================================
blue "15. GET /subscriptions/my/access/:examId — active subscription"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/my/access/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Check access (has subscription)" 200 "$STATUS" "$BODY"
assert_value  "  returns active subscription" '"status":"ACTIVE"' "$BODY"

# ============================================================
# 16. CHECK ACCESS — learner with no subscription
#     Prisma returns null which NestJS serialises as an empty body
# ============================================================
blue "16. GET /subscriptions/my/access/:examId — no subscription (should return empty/null)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/my/access/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER2_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Check access (no subscription) → 200" 200 "$STATUS" "$BODY"
if [[ -z "$BODY" || "$BODY" == "null" ]]; then
  green "  no subscription returned (null/empty — correct)"
  PASS=$((PASS+1))
else
  red "  expected null/empty body for no-subscription, got: $BODY"
  FAIL=$((FAIL+1))
fi

# ============================================================
# 17. CANCEL SUBSCRIPTION
# ============================================================
blue "17. DELETE /subscriptions/my/:id/cancel"
RES=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/subscriptions/my/$RENEWED_SUB_ID/cancel" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Cancel subscription" 200 "$STATUS" "$BODY"
assert_value  "  status is CANCELLED" '"status":"CANCELLED"' "$BODY"

# ============================================================
# 18. CANCEL already-cancelled subscription (should 400)
# ============================================================
blue "18. DELETE /subscriptions/my/:id/cancel — already cancelled (should 400)"
RES=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/subscriptions/my/$RENEWED_SUB_ID/cancel" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Cancel already-cancelled → 400" 400 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 19. CANCEL OTHER USER'S SUBSCRIPTION (should 404)
# ============================================================
blue "19. DELETE /subscriptions/my/:id/cancel — wrong user (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE/subscriptions/my/$RENEWED_SUB_ID/cancel" \
  -H "Authorization: Bearer $LEARNER2_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Cancel other user's sub → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 20. ADMIN — GET ALL SUBSCRIPTIONS
# ============================================================
blue "20. GET /subscriptions/admin/all (admin)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/admin/all?page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET all subscriptions (admin)" 200 "$STATUS" "$BODY"
assert_field  "  response has total" "total" "$BODY"
assert_field  "  response has items" "items" "$BODY"
assert_field  "  response has page" "page" "$BODY"

# ============================================================
# 21. ADMIN — GET ALL SUBSCRIPTIONS — non-admin (should 403)
# ============================================================
blue "21. GET /subscriptions/admin/all — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/admin/all" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET all subscriptions as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 22. ADMIN GRANT ACCESS (override)
# ============================================================
blue "22. POST /subscriptions/admin/grant — admin grant to learner 2"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/admin/grant" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$LEARNER2_ID\",\"packId\":\"$ACTIVE_PACK_ID\",\"durationDaysOverride\":7}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Admin grant access" 201 "$STATUS" "$BODY"
assert_value  "  status ACTIVE" '"status":"ACTIVE"' "$BODY"
assert_value  "  providerReference ADMIN_OVERRIDE" "ADMIN_OVERRIDE" "$BODY"

# Learner 2 should now have access
blue "22b. GET /subscriptions/my/access/:examId — learner 2 after admin grant"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/subscriptions/my/access/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER2_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner 2 has access after admin grant" 200 "$STATUS" "$BODY"
assert_value  "  returns ACTIVE subscription" '"status":"ACTIVE"' "$BODY"

# ============================================================
# 23. EXPIRE STALE SUBSCRIPTIONS (admin utility endpoint)
# ============================================================
blue "23. POST /subscriptions/admin/expire-stale"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/subscriptions/admin/expire-stale" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Expire stale subscriptions" 201 "$STATUS" "$BODY"
assert_field  "  response has expired count" "expired" "$BODY"

# ============================================================
# 24. RE-ENABLE FIRST PACK (restore state)
# ============================================================
blue "24. PATCH /subscriptions/packs/:id/toggle — re-enable first pack"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/subscriptions/packs/$PACK_ID/toggle" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Re-enable first pack" 200 "$STATUS" "$BODY"
assert_value  "  isActive is true" '"isActive":true' "$BODY"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS+FAIL))
echo ""
echo "============================================================"
printf " Results: \033[32m%d passed\033[0m / \033[31m%d failed\033[0m / %d total\n" $PASS $FAIL $TOTAL
echo "============================================================"
echo ""
dim "Exam ID: $EXAM_ID  |  Pack IDs: $PACK_ID  $ACTIVE_PACK_ID"
echo ""

[[ $FAIL -eq 0 ]]
