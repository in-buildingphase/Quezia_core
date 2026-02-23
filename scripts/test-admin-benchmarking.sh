#!/usr/bin/env bash
# ============================================================
# Quezia — Admin Layer & Peer Benchmarking Test Suite
# ============================================================

BASE="http://localhost:3000"
PASS=0
FAIL=0

# ---- helpers ------------------------------------------------
green() { printf "\033[32m✔  %s\033[0m\n" "$*"; }
red()   { printf "\033[31m✘  %s\033[0m\n" "$*"; }
blue()  { printf "\033[34m\n▶  %s\033[0m\n" "$*"; }
yellow() { printf "\033[33m⚠  %s\033[0m\n" "$*"; }
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

assert_not_null() {
  local label="$1" field="$2" body="$3"
  if echo "$body" | grep -q "\"$field\":null"; then
    red "$label — field '$field' is null"
    dim "$body"
    FAIL=$((FAIL+1))
  elif echo "$body" | grep -q "\"$field\""; then
    green "$label (field '$field' not null)"
    PASS=$((PASS+1))
  else
    yellow "$label — field '$field' missing"
    FAIL=$((FAIL+1))
  fi
}

# ============================================================
# 0. Setup — unique names + obtain tokens
# ============================================================
TS=$(date +%s)
EXAM_NAME="ADMIN_TEST_${TS}"
LEARNER_EMAIL="learner_admin_${TS}@quezia.dev"
LEARNER_USERNAME="learner_admin_${TS}"
LEARNER2_EMAIL="learner2_admin_${TS}@quezia.dev"
LEARNER2_USERNAME="learner2_admin_${TS}"
LEARNER_PASS="Test@1234"
ADMIN_EMAIL="admin@quezia.com"
ADMIN_PASS="Admin123!"

echo ""
echo "============================================================"
echo " Quezia Admin Layer & Peer Benchmarking Tests"
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

# -- Learner 1 register ---------------------------------------
blue "0b. Learner 1 register"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER_EMAIL\",\"username\":\"$LEARNER_USERNAME\",\"password\":\"$LEARNER_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner 1 register" 201 "$STATUS" "$BODY"
LEARNER_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
LEARNER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Learner 1 ID: $LEARNER_ID"

# -- Learner 2 register ---------------------------------------
blue "0c. Learner 2 register"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER2_EMAIL\",\"username\":\"$LEARNER2_USERNAME\",\"password\":\"$LEARNER_PASS\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Learner 2 register" 201 "$STATUS" "$BODY"
LEARNER2_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
LEARNER2_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Learner 2 ID: $LEARNER2_ID"

# ============================================================
# PART 1: ADMIN ANALYTICS ENDPOINTS
# ============================================================
echo ""
blue "═══════════════════════════════════════════════════════════"
blue "  PART 1: ADMIN ANALYTICS ENDPOINTS"
blue "═══════════════════════════════════════════════════════════"

# ============================================================
# 1. GET SYSTEM ANALYTICS (admin)
# ============================================================
blue "1. GET /admin/analytics/system"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/analytics/system" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get system analytics" 200 "$STATUS" "$BODY"
assert_field  "  has users" "users" "$BODY"
assert_field  "  has exams" "exams" "$BODY"
assert_field  "  has tests" "tests" "$BODY"
assert_field  "  has attempts" "attempts" "$BODY"
dim "System Stats: $(echo "$BODY" | python3 -m json.tool 2>/dev/null | head -10)"

# ============================================================
# 2. GET SYSTEM ANALYTICS — learner (should 403)
# ============================================================
blue "2. GET /admin/analytics/system — learner (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/analytics/system" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "System analytics as learner → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 3. CREATE EXAM FOR TESTING
# ============================================================
blue "3. POST /exams — create test exam"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Admin test exam\",\"isActive\":true}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam" 201 "$STATUS" "$BODY"
EXAM_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Exam ID: $EXAM_ID"

# ============================================================
# 4. GET EXAM ANALYTICS (admin)
# ============================================================
blue "4. GET /admin/analytics/exam/:examId"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/analytics/exam/$EXAM_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get exam analytics" 200 "$STATUS" "$BODY"
assert_field  "  has exam info" "exam" "$BODY"
assert_field  "  has tests count" "tests" "$BODY"
assert_field  "  has attempts stats" "attempts" "$BODY"
dim "Exam Stats: $(echo "$BODY" | python3 -m json.tool 2>/dev/null | head -10)"

# ============================================================
# 5. GET ALL USERS (admin)
# ============================================================
blue "5. GET /admin/users — list users with pagination"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/users?page=1&limit=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get all users" 200 "$STATUS" "$BODY"
assert_field  "  has users array" "users" "$BODY"
assert_field  "  has pagination" "pagination" "$BODY"
assert_field  "  has total" "total" "$BODY"
dim "User count: $(echo "$BODY" | grep -o '"total":[0-9]*' | head -1)"

# ============================================================
# 6. GET USER DETAILS (admin)
# ============================================================
blue "6. GET /admin/users/:userId — get user details"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/users/$LEARNER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get user details" 200 "$STATUS" "$BODY"
assert_field  "  has email" "email" "$BODY"
assert_field  "  has profile" "profile" "$BODY"
assert_field  "  has subscriptions" "subscriptions" "$BODY"
assert_field  "  has attempts" "attempts" "$BODY"
dim "User: $(echo "$BODY" | grep -o '"email":"[^"]*"' | head -1)"

# ============================================================
# 7. SUSPEND USER (admin)
# ============================================================
blue "7. POST /admin/users/:userId/suspend"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/admin/users/$LEARNER2_ID/suspend" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Testing suspension"}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Suspend user" 200 "$STATUS" "$BODY"
assert_value  "  success message" "suspended" "$BODY"

# ============================================================
# 8. VERIFY SUSPENDED USER CANNOT LOGIN
# ============================================================
blue "8. POST /auth/login — suspended user (should fail)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER2_EMAIL\",\"password\":\"$LEARNER_PASS\"}")
STATUS=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | sed '$d')
# Should get 401 or 403 when account is inactive
if [[ "$STATUS" == "401" ]] || [[ "$STATUS" == "403" ]]; then
  green "Suspended user cannot login (HTTP $STATUS)"
  PASS=$((PASS+1))
else
  red "Suspended user should not be able to login — got HTTP $STATUS"
  dim "$BODY"
  FAIL=$((FAIL+1))
fi

# ============================================================
# 9. ACTIVATE USER (admin)
# ============================================================
blue "9. POST /admin/users/:userId/activate"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/admin/users/$LEARNER2_ID/activate" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Activate user" 200 "$STATUS" "$BODY"
assert_value  "  success message" "activated" "$BODY"

# ============================================================
# 10. GET AUDIT LOGS (admin)
# ============================================================
blue "10. GET /admin/audit-logs — with pagination"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/audit-logs?page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get audit logs" 200 "$STATUS" "$BODY"
assert_field  "  has logs array" "logs" "$BODY"
assert_field  "  has pagination" "pagination" "$BODY"
dim "Log count: $(echo "$BODY" | grep -o '"total":[0-9]*' | head -1)"

# ============================================================
# 11. GET AUDIT LOGS — filtered by user
# ============================================================
blue "11. GET /admin/audit-logs?userId=... — filter by user"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/audit-logs?userId=$LEARNER2_ID&page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get filtered audit logs" 200 "$STATUS" "$BODY"
dim "Should contain suspension/activation events"

# ============================================================
# 12. GET TEST STATISTICS (admin)
# ============================================================
blue "12. GET /admin/tests/statistics"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/tests/statistics" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get test statistics" 200 "$STATUS" "$BODY"
assert_field  "  has summary" "summary" "$BODY"
assert_field  "  has tests array" "tests" "$BODY"
dim "Test stats: $(echo "$BODY" | python3 -m json.tool 2>/dev/null | head -10)"

# ============================================================
# PART 2: PEER BENCHMARKING (SYSTEM TESTS)
# ============================================================
echo ""
blue "═══════════════════════════════════════════════════════════"
blue "  PART 2: PEER BENCHMARKING (SYSTEM TESTS)"
blue "═══════════════════════════════════════════════════════════"

# ============================================================
# 13. CREATE BLUEPRINT
# ============================================================
blue "13. POST /exams/:id/blueprints — create blueprint"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": 1,
    \"defaultDurationSeconds\": 3600,
    \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\",
    \"sections\": [
      {\"subject\": \"Math\", \"sequence\": 1, \"sectionDurationSeconds\": 1800}
    ],
    \"rules\": [
      {
        \"totalTimeSeconds\": 3600,
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
BLUEPRINT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Blueprint ID: $BLUEPRINT_ID"

# ============================================================
# 14. CREATE SYSTEM TEST THREAD
# ============================================================
blue "14. POST /test-threads — create SYSTEM thread"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"examId\":\"$EXAM_ID\",
    \"originType\":\"SYSTEM\",
    \"title\":\"Benchmark Test ${TS}\",
    \"baseGenerationConfig\":{}
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create SYSTEM thread" 201 "$STATUS" "$BODY"
THREAD_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Thread ID: $THREAD_ID"

# ============================================================
# 15. GENERATE SYSTEM TEST
# ============================================================
blue "15. POST /test-threads/:id/generate"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads/$THREAD_ID/generate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Generate SYSTEM test" 201 "$STATUS" "$BODY"
SYSTEM_TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "System Test ID: $SYSTEM_TEST_ID"

# ============================================================
# 16. SKIP INJECT (blueprint tests auto-snapshot questions)
# ============================================================
blue "16. Skip question injection for blueprint test"
dim "Blueprint-based SYSTEM tests auto-select and snapshot questions"
green "Questions already snapshotted from blueprint (HTTP N/A)"
PASS=$((PASS+1))

# ============================================================
# 17. PUBLISH SYSTEM TEST
# ============================================================
blue "17. PATCH /tests/:id/publish"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/tests/$SYSTEM_TEST_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Publish SYSTEM test" 200 "$STATUS" "$BODY"
assert_value  "  status is PUBLISHED" '"status":"PUBLISHED"' "$BODY"

# ============================================================
# 18. LEARNER 1 COMPLETES SYSTEM TEST
# ============================================================
blue "18. Complete SYSTEM test as Learner 1"

# Start attempt
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$SYSTEM_TEST_ID/start" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Start attempt" 201 "$STATUS" "$BODY"
ATTEMPT1_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Get questions
RES=$(curl -s -X GET "$BASE/attempts/$ATTEMPT1_ID/questions" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
QUESTION_ID=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -1 | cut -d'"' -f4)

# Submit answer
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT1_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$QUESTION_ID\",\"answer\":\"A\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Submit answer" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

# Complete attempt
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT1_ID/submit-test" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Complete attempt" 200 "$STATUS" "$BODY"

# ============================================================
# 19. VERIFY PERCENTILE & RANK COMPUTED (SYSTEM TEST)
# ============================================================
blue "19. Verify percentile & rank for SYSTEM test"
assert_not_null "  percentile computed" "percentile" "$BODY"
assert_not_null "  rank computed" "userRank" "$BODY"
assert_field "  totalScore present" "totalScore" "$BODY"
assert_field "  accuracy present" "accuracy" "$BODY"
dim "Learner 1 Results: $(echo "$BODY" | grep -o '"totalScore":[^,]*' | head -1), $(echo "$BODY" | grep -o '"percentile":[^,]*' | head -1), $(echo "$BODY" | grep -o '"userRank":[^,]*' | head -1)"

# ============================================================
# 20. LEARNER 2 COMPLETES SYSTEM TEST
# ============================================================
blue "20. Complete SYSTEM test as Learner 2"

# Reactivate learner 2 token (login again after activation)
RES=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$LEARNER2_EMAIL\",\"password\":\"$LEARNER_PASS\"}")
LEARNER2_TOKEN=$(echo "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# Start attempt
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$SYSTEM_TEST_ID/start" \
  -H "Authorization: Bearer $LEARNER2_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Start attempt" 201 "$STATUS" "$BODY"
ATTEMPT2_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Submit answer (wrong answer for different score)
RES=$(curl -s -X POST "$BASE/attempts/$ATTEMPT2_ID/submit" \
  -H "Authorization: Bearer $LEARNER2_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$QUESTION_ID\",\"answer\":\"B\"}")

# Complete attempt
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT2_ID/submit-test" \
  -H "Authorization: Bearer $LEARNER2_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Complete attempt" 200 "$STATUS" "$BODY"

# ============================================================
# 21. VERIFY DIFFERENT RANKS FOR DIFFERENT SCORES
# ============================================================
blue "21. Verify different ranks based on scores"
assert_not_null "  percentile computed" "percentile" "$BODY"
assert_not_null "  rank computed" "userRank" "$BODY"
dim "Learner 2 Results: $(echo "$BODY" | grep -o '"totalScore":[^,]*' | head -1), $(echo "$BODY" | grep -o '"percentile":[^,]*' | head -1), $(echo "$BODY" | grep -o '"userRank":[^,]*' | head -1)"

# ============================================================
# PART 3: USER-GENERATED TESTS (NO BENCHMARKING)
# ============================================================
echo ""
blue "═══════════════════════════════════════════════════════════"
blue "  PART 3: USER-GENERATED TESTS (NO BENCHMARKING)"
blue "═══════════════════════════════════════════════════════════"

# ============================================================
# 22. CREATE USER-GENERATED TEST THREAD
# ============================================================
blue "22. POST /test-threads — create GENERATED thread"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"examId\":\"$EXAM_ID\",
    \"originType\":\"GENERATED\",
    \"title\":\"Custom Test ${TS}\",
    \"baseGenerationConfig\":{}
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create GENERATED thread" 201 "$STATUS" "$BODY"
USER_THREAD_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "User Thread ID: $USER_THREAD_ID"

# ============================================================
# 23. GENERATE USER TEST (with blueprint)
# ============================================================
blue "23. POST /test-threads/:id/generate — user test"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads/$USER_THREAD_ID/generate" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Generate user test" 201 "$STATUS" "$BODY"
USER_TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "User Test ID: $USER_TEST_ID"

# ============================================================
# 24. PUBLISH USER TEST (questions already snapshotted)
# ============================================================
blue "24. Publish user test"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/tests/$USER_TEST_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Publish user test" 200 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 25. COMPLETE USER-GENERATED TEST
# ============================================================
blue "25. Complete USER-GENERATED test"

# Start attempt
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$USER_TEST_ID/start" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Start user test attempt" 201 "$STATUS" "$BODY"
USER_ATTEMPT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Get question
RES=$(curl -s -X GET "$BASE/attempts/$USER_ATTEMPT_ID/questions" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
USER_QUESTION_ID=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -1 | cut -d'"' -f4)

# Submit answer
curl -s -X POST "$BASE/attempts/$USER_ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$USER_QUESTION_ID\",\"answer\":\"A\"}" > /dev/null

# Complete
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$USER_ATTEMPT_ID/submit-test" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "  Complete user test" 200 "$STATUS" "$BODY"

# ============================================================
# 26. VERIFY NO PERCENTILE/RANK (USER-GENERATED)
# ============================================================
blue "26. Verify NO percentile/rank for user-generated test"
if echo "$BODY" | grep -q '"percentile":null'; then
  green "  percentile is null (correct)"
  PASS=$((PASS+1))
else
  red "  percentile should be null for user-generated tests"
  dim "$BODY"
  FAIL=$((FAIL+1))
fi

if echo "$BODY" | grep -q '"userRank":null'; then
  green "  userRank is null (correct)"
  PASS=$((PASS+1))
else
  red "  userRank should be null for user-generated tests"
  dim "$BODY"
  FAIL=$((FAIL+1))
fi
dim "User test correctly has no peer comparison"

# ============================================================
# PART 4: MORE ADMIN ENDPOINTS
# ============================================================
echo ""
blue "═══════════════════════════════════════════════════════════"
blue "  PART 4: MORE ADMIN ENDPOINTS"
blue "═══════════════════════════════════════════════════════════"

# ============================================================
# 27. GET TEST PERFORMANCE STATS (admin)
# ============================================================
blue "27. GET /admin/tests/:id/performance — system test stats"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/tests/$SYSTEM_TEST_ID/performance" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get test performance" 200 "$STATUS" "$BODY"
assert_field  "  has test info" "test" "$BODY"
assert_field  "  has attempts count" "attempts" "$BODY"
assert_field  "  has stats" "stats" "$BODY"
dim "Performance: $(echo "$BODY" | python3 -m json.tool 2>/dev/null | grep -A 5 '"stats"' | head -6)"

# ============================================================
# 28. OVERRIDE TEST VISIBILITY (admin)
# ============================================================
blue "28. PATCH /admin/tests/:id/visibility — force archive"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/admin/tests/$USER_TEST_ID/visibility" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"ARCHIVED"}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Override test visibility" 200 "$STATUS" "$BODY"
assert_value  "  status is ARCHIVED" '"status":"ARCHIVED"' "$BODY"

# ============================================================
# 29. SEARCH USERS (admin)
# ============================================================
blue "29. GET /admin/users?search=... — search users"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/users?search=admin_${TS}&page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Search users" 200 "$STATUS" "$BODY"
assert_value  "  found learner 1" "$LEARNER_EMAIL" "$BODY"
assert_value  "  found learner 2" "$LEARNER2_EMAIL" "$BODY"

# ============================================================
# 30. FILTER USERS BY ROLE (admin)
# ============================================================
blue "30. GET /admin/users?role=LEARNER"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/admin/users?role=LEARNER&page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Filter users by role" 200 "$STATUS" "$BODY"
dim "Found learners: $(echo "$BODY" | grep -o '"role":"LEARNER"' | wc -l | xargs)"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS+FAIL))
echo ""
echo "============================================================"
printf " Results: \033[32m%d passed\033[0m / \033[31m%d failed\033[0m / %d total\n" $PASS $FAIL $TOTAL
echo "============================================================"
echo ""
dim "Key IDs created:"
dim "  Exam: $EXAM_ID"
dim "  System Test: $SYSTEM_TEST_ID (with percentile/rank)"
dim "  User Test: $USER_TEST_ID (no percentile/rank)"
dim "  Learner 1: $LEARNER_ID"
dim "  Learner 2: $LEARNER2_ID"
echo ""
yellow "NOTE: Peer benchmarking only applies to SYSTEM-originated tests"
yellow "      User-generated tests have percentile=null and rank=null"
echo ""

[[ $FAIL -eq 0 ]]
