#!/usr/bin/env bash
# ============================================================
# Quezia — Exam & ExamBlueprint endpoint smoke test
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
# 0. Setup — unique names + obtain tokens
# ============================================================
TS=$(date +%s)
EXAM_NAME="JAMB_${TS}"
LEARNER_EMAIL="learner_exam_${TS}@quezia.dev"
LEARNER_USERNAME="learner_exam_${TS}"
LEARNER_PASS="Test@1234"
ADMIN_EMAIL="admin@quezia.com"
ADMIN_PASS="Admin123!"

echo ""
echo "============================================================"
echo " Quezia Exam & Blueprint Endpoint Tests"
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
if [[ -z "$ADMIN_TOKEN" ]]; then
  red "FATAL: Could not obtain admin token — is the server running and admin seeded?"
  dim "Run: npx ts-node -r tsconfig-paths/register scripts/create-admin.ts"
  exit 1
fi
dim "Admin token acquired"

# -- Learner register -----------------------------------------
blue "0b. Learner register"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER_EMAIL\",\"username\":\"$LEARNER_USERNAME\",\"password\":\"$LEARNER_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner register" 201 "$STATUS" "$BODY"
LEARNER_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
dim "Learner token acquired"

# ============================================================
# 1. CREATE EXAM (admin)
# ============================================================
blue "1. POST /exams — create exam (admin)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Joint Admissions test\",\"isActive\":true}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam" 201 "$STATUS" "$BODY"
assert_field "  exam has id" "id" "$BODY"
assert_field "  exam has name" "name" "$BODY"
assert_field "  exam has isActive" "isActive" "$BODY"
EXAM_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Exam ID: $EXAM_ID"

# ============================================================
# 2. CREATE EXAM — non-admin must get 403
# ============================================================
blue "2. POST /exams — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${EXAM_NAME}_x\",\"isActive\":true}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 3. CREATE EXAM — unauthenticated must get 401
# ============================================================
blue "3. POST /exams — no token (should 401)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${EXAM_NAME}_y\",\"isActive\":true}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam unauthenticated → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 4. GET ALL EXAMS
# ============================================================
blue "4. GET /exams"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET /exams" 200 "$STATUS" "$BODY"
assert_value  "Response is an array" "\[" "$BODY"

# ============================================================
# 5. GET EXAM BY ID
# ============================================================
blue "5. GET /exams/:id"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET /exams/:id" 200 "$STATUS" "$BODY"
assert_field  "  exam has blueprints array" "blueprints" "$BODY"

# ============================================================
# 6. GET EXAM BY ID — not found
# ============================================================
blue "6. GET /exams/nonexistent (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams/nonexistent-id-xyz" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET /exams/nonexistent → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 7. UPDATE EXAM — change description (admin)
# ============================================================
blue "7. PATCH /exams/:id — update description"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/exams/$EXAM_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated description for JAMB"}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "PATCH exam description" 200 "$STATUS" "$BODY"
assert_value  "  description updated" "Updated description" "$BODY"

# ============================================================
# 8. DEACTIVATE EXAM (admin)
# ============================================================
blue "8. PATCH /exams/:id — deactivate"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/exams/$EXAM_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":false}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Deactivate exam" 200 "$STATUS" "$BODY"
assert_value  "  isActive is false" '"isActive":false' "$BODY"

# ============================================================
# 9. RE-ACTIVATE EXAM (admin)
# ============================================================
blue "9. PATCH /exams/:id — reactivate"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/exams/$EXAM_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":true}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Reactivate exam" 200 "$STATUS" "$BODY"

# ============================================================
# 10. CREATE BLUEPRINT (admin)
# ============================================================
FUTURE_DATE="2026-03-01T00:00:00.000Z"
FAR_DATE="2027-01-01T00:00:00.000Z"

blue "10. POST /exams/:id/blueprints — create blueprint (admin)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": 1,
    \"defaultDurationSeconds\": 7200,
    \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\",
    \"sections\": [
      {\"subject\": \"Mathematics\", \"sequence\": 1, \"sectionDurationSeconds\": 1800},
      {\"subject\": \"English\",     \"sequence\": 2},
      {\"subject\": \"Physics\",     \"sequence\": 3}
    ],
    \"rules\": [
      {
        \"totalTimeSeconds\": 7200,
        \"negativeMarking\": true,
        \"negativeMarkValue\": 0.25,
        \"partialMarking\": false,
        \"adaptiveAllowed\": false,
        \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\"
      }
    ]
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create blueprint" 201 "$STATUS" "$BODY"
assert_field  "  blueprint has id" "id" "$BODY"
assert_field  "  blueprint has sections" "sections" "$BODY"
assert_field  "  blueprint has rules" "rules" "$BODY"
assert_field  "  blueprint has version" "version" "$BODY"
BLUEPRINT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Blueprint ID: $BLUEPRINT_ID"

# ============================================================
# 11. CREATE BLUEPRINT — missing required field (should 400)
# ============================================================
blue "11. POST /exams/:id/blueprints — missing version (should 400)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[],\"rules\":[]}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create blueprint missing version → 400" 400 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 12. CREATE BLUEPRINT — for non-existent exam (should 404)
# ============================================================
blue "12. POST /exams/nonexistent/blueprints (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/nonexistent-exam/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"version\":99,\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[],\"rules\":[]}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Blueprint for nonexistent exam → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 13. GET BLUEPRINT BY ID
# ============================================================
blue "13. GET /exams/blueprints/:id"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams/blueprints/$BLUEPRINT_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET blueprint by id" 200 "$STATUS" "$BODY"
assert_field  "  blueprint has sections" "sections" "$BODY"
assert_field  "  blueprint has rules" "rules" "$BODY"

# ============================================================
# 14. GET BLUEPRINT — not found
# ============================================================
blue "14. GET /exams/blueprints/nonexistent (should 404)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams/blueprints/nonexistent-bp" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET blueprint nonexistent → 404" 404 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 15. GET ACTIVE BLUEPRINT FOR EXAM
# ============================================================
blue "15. GET /exams/:id/blueprints/active"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/exams/$EXAM_ID/blueprints/active" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET active blueprint" 200 "$STATUS" "$BODY"
# Blueprint created with effectiveFrom in the past and no effectiveTo — should be returned
assert_field  "  active blueprint has id" "id" "$BODY"

# ============================================================
# 16. ACTIVATE BLUEPRINT — update effective window (admin)
# ============================================================
blue "16. POST /exams/blueprints/:id/activate"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/blueprints/$BLUEPRINT_ID/activate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"effectiveTo\":\"$FAR_DATE\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Activate blueprint (set window)" 201 "$STATUS" "$BODY"
assert_value  "  effectiveTo set" "effectiveTo" "$BODY"

# ============================================================
# 17. ACTIVATE BLUEPRINT — non-admin must get 403
# ============================================================
blue "17. POST /exams/blueprints/:id/activate — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/blueprints/$BLUEPRINT_ID/activate" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"effectiveFrom":"2025-01-01T00:00:00.000Z"}')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Activate blueprint as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 18. CREATE A SECOND BLUEPRINT (to archive)
# ============================================================
blue "18. POST /exams/:id/blueprints — second blueprint (to archive)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": 2,
    \"defaultDurationSeconds\": 5400,
    \"effectiveFrom\": \"2024-01-01T00:00:00.000Z\",
    \"sections\": [
      {\"subject\": \"Chemistry\", \"sequence\": 1}
    ],
    \"rules\": [
      {
        \"totalTimeSeconds\": 5400,
        \"negativeMarking\": false,
        \"partialMarking\": false,
        \"adaptiveAllowed\": true,
        \"effectiveFrom\": \"2024-01-01T00:00:00.000Z\"
      }
    ]
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create second blueprint" 201 "$STATUS" "$BODY"
BP2_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Blueprint 2 ID: $BP2_ID"

# ============================================================
# 19. ARCHIVE BLUEPRINT
# ============================================================
blue "19. POST /exams/blueprints/:id/archive"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/blueprints/$BP2_ID/archive" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Archive blueprint" 201 "$STATUS" "$BODY"
assert_field  "  archived blueprint has effectiveTo" "effectiveTo" "$BODY"

# ============================================================
# 20. ARCHIVE BLUEPRINT — non-admin must get 403
# ============================================================
blue "20. POST /exams/blueprints/:id/archive — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/blueprints/$BP2_ID/archive" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Archive blueprint as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS+FAIL))
echo ""
echo "============================================================"
printf " Results: \033[32m%d passed\033[0m / \033[31m%d failed\033[0m / %d total\n" $PASS $FAIL $TOTAL
echo "============================================================"
echo ""
dim "Exam ID created: $EXAM_ID"
echo ""

[[ $FAIL -eq 0 ]]
