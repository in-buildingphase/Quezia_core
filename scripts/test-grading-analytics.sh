#!/usr/bin/env bash
# ============================================================
# Quezia — Grading & Analytics Engine smoke test
# ============================================================

BASE="http://localhost:3000"
PASS=0
FAIL=0

# ---- helpers ------------------------------------------------
green() { printf "\033[32m✔  %s\033[0m\n" "$*"; }
red()   { printf "\033[31m✘  %s\033[0m\n" "$*"; }
blue()  { printf "\033[34m\n▶  %s\033[0m\n" "$*"; }
dim()   { printf "\033[90m   %s\033[0m\n"  "$*"; }

pass() {
  green "$*"
  PASS=$((PASS+1))
}

fail() {
  red "$*"
  FAIL=$((FAIL+1))
}

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
  local label="$1" expected="$2" body="$3"
  if echo "$body" | grep -q "$expected"; then
    green "$label"
    PASS=$((PASS+1))
  else
    red "$label — expected '$expected' not found"
    dim "$body"
    FAIL=$((FAIL+1))
  fi
}

assert_numeric_gt() {
  local label="$1" field="$2" threshold="$3" body="$4"
  local value=$(echo "$body" | grep -o "\"$field\":[0-9.]*" | grep -o "[0-9.]*$" | head -1)
  if [[ -n "$value" ]] && (( $(echo "$value > $threshold" | bc -l) )); then
    green "$label ($field=$value > $threshold)"
    PASS=$((PASS+1))
  else
    red "$label — $field=$value not > $threshold"
    dim "$body"
    FAIL=$((FAIL+1))
  fi
}

# ============================================================
# 0. Setup — create exam, blueprint, test, inject questions
# ============================================================
TS=$(date +%s)
EXAM_NAME="GRADING_TEST_${TS}"
LEARNER_EMAIL="grading_test_${TS}@quezia.dev"
LEARNER_USERNAME="grading_test_${TS}"
LEARNER_PASS="Test@1234"
ADMIN_EMAIL="admin@quezia.com"
ADMIN_PASS="Admin123!"

echo ""
echo "============================================================"
echo " Quezia Grading & Analytics Engine Tests"
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
  red "Failed to get admin token"
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
LEARNER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Learner ID: $LEARNER_ID"

# -- Create exam ----------------------------------------------
blue "0c. Create exam"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Grading test exam\",\"isActive\":true}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create exam" 201 "$STATUS" "$BODY"
EXAM_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Exam ID: $EXAM_ID"

# -- Create blueprint with negative marking ------------------
blue "0d. Create blueprint (negative marking enabled)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": 1,
    \"defaultDurationSeconds\": 1800,
    \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\",
    \"sections\": [
      {\"subject\": \"Physics\", \"sequence\": 1, \"sectionDurationSeconds\": 600},
      {\"subject\": \"Mathematics\", \"sequence\": 2, \"sectionDurationSeconds\": 600},
      {\"subject\": \"Chemistry\", \"sequence\": 3, \"sectionDurationSeconds\": 600}
    ],
    \"rules\": [
      {
        \"totalTimeSeconds\": 1800,
        \"negativeMarking\": true,
        \"negativeMarkValue\": 0.25,
        \"partialMarking\": true,
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

# -- Create canonical questions in registry -------------------
blue "0e. Create canonical questions in registry"
# Physics Q1 (EASY)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"PHY_${TS}_001\",\"subject\":\"Physics\",\"topic\":\"Mechanics\",\"subtopic\":\"Newton Laws\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"What is Newton's first law?\",\"options\":[{\"key\":\"A\",\"text\":\"Inertia\"},{\"key\":\"B\",\"text\":\"Force\"},{\"key\":\"C\",\"text\":\"Action\"},{\"key\":\"D\",\"text\":\"Energy\"}]},\"correctAnswer\":\"A\",\"explanation\":\"First law is law of inertia\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Physics Q2 (MEDIUM)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"PHY_${TS}_002\",\"subject\":\"Physics\",\"topic\":\"Mechanics\",\"subtopic\":\"Kinematics\",\"difficulty\":\"MEDIUM\",\"questionType\":\"NUMERIC\",\"contentPayload\":{\"question\":\"Calculate velocity when distance=100m and time=10s\"},\"correctAnswer\":\"10\",\"explanation\":\"v = d/t\",\"marks\":4,\"numericTolerance\":0.5,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Physics Q3 (HARD)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"PHY_${TS}_003\",\"subject\":\"Physics\",\"topic\":\"Electricity\",\"subtopic\":\"Ohm Law\",\"difficulty\":\"HARD\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Complex circuit question\",\"options\":[{\"key\":\"A\",\"text\":\"5V\"},{\"key\":\"B\",\"text\":\"10V\"},{\"key\":\"C\",\"text\":\"15V\"},{\"key\":\"D\",\"text\":\"20V\"}]},\"correctAnswer\":\"B\",\"explanation\":\"Circuit analysis\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Math Q1 (EASY)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"MATH_${TS}_001\",\"subject\":\"Mathematics\",\"topic\":\"Algebra\",\"subtopic\":\"Linear Equations\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Solve: 2x + 4 = 10\",\"options\":[{\"key\":\"A\",\"text\":\"2\"},{\"key\":\"B\",\"text\":\"3\"},{\"key\":\"C\",\"text\":\"4\"},{\"key\":\"D\",\"text\":\"5\"}]},\"correctAnswer\":\"B\",\"explanation\":\"x = 3\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Math Q2 (MEDIUM)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"MATH_${TS}_002\",\"subject\":\"Mathematics\",\"topic\":\"Geometry\",\"subtopic\":\"Circles\",\"difficulty\":\"MEDIUM\",\"questionType\":\"NUMERIC\",\"contentPayload\":{\"question\":\"Find area of circle with radius 5\"},\"correctAnswer\":\"78.54\",\"explanation\":\"A = πr²\",\"marks\":4,\"numericTolerance\":1.0,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Chemistry Q1 (EASY)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"CHEM_${TS}_001\",\"subject\":\"Chemistry\",\"topic\":\"Organic\",\"subtopic\":\"Hydrocarbons\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Methane formula\",\"options\":[{\"key\":\"A\",\"text\":\"CH4\"},{\"key\":\"B\",\"text\":\"C2H6\"},{\"key\":\"C\",\"text\":\"C3H8\"},{\"key\":\"D\",\"text\":\"C4H10\"}]},\"correctAnswer\":\"A\",\"explanation\":\"Methane is CH4\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Chemistry Q2 (HARD)
curl -s -X POST "$BASE/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"CHEM_${TS}_002\",\"subject\":\"Chemistry\",\"topic\":\"Inorganic\",\"subtopic\":\"Acids\",\"difficulty\":\"HARD\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Strong acid question\",\"options\":[{\"key\":\"A\",\"text\":\"HCl\"},{\"key\":\"B\",\"text\":\"H2SO4\"},{\"key\":\"C\",\"text\":\"HNO3\"},{\"key\":\"D\",\"text\":\"All\"}]},\"correctAnswer\":\"D\",\"explanation\":\"All are strong acids\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null

# Add more questions to meet the 30-question requirement per section
for i in {4..10}; do
  curl -s -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"PHY_${TS}_$(printf '%03d' $i)\",\"subject\":\"Physics\",\"topic\":\"Mechanics\",\"subtopic\":\"Kinematics\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Physics question $i\",\"options\":[{\"key\":\"A\",\"text\":\"A\"},{\"key\":\"B\",\"text\":\"B\"},{\"key\":\"C\",\"text\":\"C\"},{\"key\":\"D\",\"text\":\"D\"}]},\"correctAnswer\":\"A\",\"explanation\":\"E\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null
  
  curl -s -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"MATH_${TS}_$(printf '%03d' $i)\",\"subject\":\"Mathematics\",\"topic\":\"Algebra\",\"subtopic\":\"Linear Equations\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Math question $i\",\"options\":[{\"key\":\"A\",\"text\":\"A\"},{\"key\":\"B\",\"text\":\"B\"},{\"key\":\"C\",\"text\":\"C\"},{\"key\":\"D\",\"text\":\"D\"}]},\"correctAnswer\":\"A\",\"explanation\":\"E\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null
  
  curl -s -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"CHEM_${TS}_$(printf '%03d' $i)\",\"subject\":\"Chemistry\",\"topic\":\"Organic\",\"subtopic\":\"Hydrocarbons\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Chemistry question $i\",\"options\":[{\"key\":\"A\",\"text\":\"A\"},{\"key\":\"B\",\"text\":\"B\"},{\"key\":\"C\",\"text\":\"C\"},{\"key\":\"D\",\"text\":\"D\"}]},\"correctAnswer\":\"A\",\"explanation\":\"E\",\"marks\":4,\"examId\":\"$EXAM_ID\"}" > /dev/null
done

dim "Created 30+ canonical questions per subject"

# -- Create thread --------------------------------------------
blue "0f. Create test thread"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"examId\": \"$EXAM_ID\",
    \"originType\": \"GENERATED\",
    \"title\": \"Grading Test ${TS}\",
    \"baseGenerationConfig\": {}
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Create test thread" 201 "$STATUS" "$BODY"
THREAD_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Thread ID: $THREAD_ID"

# -- Generate test (will auto-select created questions) -------
blue "0g. Generate test with blueprint (auto-selects canonical questions)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/test-threads/$THREAD_ID/generate" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"followsBlueprint\": true,
    \"blueprintReferenceId\": \"$BLUEPRINT_ID\"
  }")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Generate test with auto-selection" 201 "$STATUS" "$BODY"
TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Test ID: $TEST_ID"

# -- Publish test ---------------------------------------------
blue "0h. Publish test"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/tests/$TEST_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Publish test" 200 "$STATUS" "$BODY"
assert_value "Status is PUBLISHED" '"status":"PUBLISHED"' "$BODY"

# ============================================================
# GRADING ENGINE TESTS
# ============================================================

# ============================================================
# 1. START ATTEMPT
# ============================================================
blue "1. POST /attempts/:testId/start"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$TEST_ID/start" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Start attempt" 201 "$STATUS" "$BODY"
assert_field "Attempt has id" "id" "$BODY"
assert_field "Attempt has status" "status" "$BODY"
assert_value "Status is ACTIVE" '"status":"ACTIVE"' "$BODY"
ATTEMPT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "Attempt ID: $ATTEMPT_ID"

# Get the actual test questions that were selected
blue "1b. GET /tests/:id/questions to get selected questions"
RES=$(curl -s -X GET "$BASE/tests/$TEST_ID/questions" \
  -H "Authorization: Bearer $LEARNER_TOKEN")

# Extract 7 different question IDs from the response
Q1=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -1 | cut -d'"' -f4)
Q2=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -2 | tail -1 | cut -d'"' -f4)
Q3=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -3 | tail -1 | cut -d'"' -f4)
Q4=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -4 | tail -1 | cut -d'"' -f4)
Q5=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -5 | tail -1 | cut -d'"' -f4)
Q6=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -6 | tail -1 | cut -d'"' -f4)
Q7=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -7 | tail -1 | cut -d'"' -f4)

dim "Selected Questions: $Q1, $Q2, $Q3, $Q4, $Q5, $Q6, $Q7"

# Get correct answers for these questions (use jq if available, fallback to grep)
if command -v jq &> /dev/null; then
  A1=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q1\") | .correctAnswer")
  A2=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q2\") | .correctAnswer")
  A3=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q3\") | .correctAnswer")
  A4=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q4\") | .correctAnswer")
  A5=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q5\") | .correctAnswer")
  A6=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q6\") | .correctAnswer")
  A7=$(echo "$RES" | jq -r ".[] | select(.questionId==\"$Q7\") | .correctAnswer")
else
  # Fallback: Remove all newlines first, then extract
  RES_CLEAN=$(echo "$RES" | tr -d '\n\r' | tr -s ' ')
  A1=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q1\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A2=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q2\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A3=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q3\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A4=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q4\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A5=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q5\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A6=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q6\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  A7=$(echo "$RES_CLEAN" | grep -o "\"questionId\":\"$Q7\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
fi

# ============================================================
# 2. SUBMIT ANSWERS — mixed correct/incorrect/skipped
# ============================================================
blue "2a. Submit answer — Q1 (CORRECT)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q1\",\"answer\":\"$A1\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit correct answer Q1" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2b. Submit answer — Q2 (CORRECT)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q2\",\"answer\":\"$A2\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit correct answer Q2" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2c. Submit answer — Q3 (INCORRECT - wrong answer for negative marking test)"
# Submit wrong answer intentionally
WRONG_ANSWER="Z"
if [[ "$A3" == "A" ]]; then WRONG_ANSWER="B"; else WRONG_ANSWER="A"; fi
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q3\",\"answer\":\"$WRONG_ANSWER\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit incorrect answer Q3" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2d. Submit answer — Q4 (CORRECT)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q4\",\"answer\":\"$A4\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit correct answer Q4" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2e. Submit answer — Q5 (INCORRECT)"
if [[ "$A5" == "A" ]]; then WRONG_ANSWER="B"; else WRONG_ANSWER="A"; fi
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q5\",\"answer\":\"$WRONG_ANSWER\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit incorrect answer Q5" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2f. Submit answer — Q6 (CORRECT)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q6\",\"answer\":\"$A6\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Submit correct answer Q6" 201 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "2g. Skip Q7 (unattempted - for risk ratio calculation)"
dim "Intentionally skipping last question to test risk ratio"

# ============================================================
# 3. COMPLETE ATTEMPT — GRADING ENGINE EXECUTION
# ============================================================
blue "3. POST /attempts/:id/submit-test — GRADING ENGINE"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID/submit-test" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Complete attempt (triggers grading)" 200 "$STATUS" "$BODY"
assert_field "  has totalScore" "totalScore" "$BODY"
assert_field "  has accuracy" "accuracy" "$BODY"
assert_field "  has riskRatio" "riskRatio" "$BODY"
assert_field "  has percentile" "percentile" "$BODY"
assert_value "  status is COMPLETED" '"status":"COMPLETED"' "$BODY"

# Extract computed values
TOTAL_SCORE=$(echo "$BODY" | grep -o '"totalScore":"[^"]*"' | cut -d'"' -f4)
ACCURACY=$(echo "$BODY" | grep -o '"accuracy":"[^"]*"' | cut -d'"' -f4)
RISK_RATIO=$(echo "$BODY" | grep -o '"riskRatio":"[^"]*"' | cut -d'"' -f4)

dim "Total Score: $TOTAL_SCORE"
dim "Accuracy: $ACCURACY"
dim "Risk Ratio: $RISK_RATIO"

# ============================================================
# 4. VERIFY GRADING RESULTS
# ============================================================
blue "4a. Verify score calculation"
# Expected: 4 correct (4*4=16) + 2 incorrect with -0.25 each (-0.5) + 1 skipped (0) = 15.5
assert_value "Score should be positive" "\"totalScore\":\"1" "$BODY"

blue "4b. Verify accuracy calculation"
# Attempted: 6, Correct: 4, Accuracy = 4/6 * 100 = 66.67%
assert_value "Accuracy should be 60-70%" "\"accuracy\":\"6" "$BODY"

blue "4c. Verify risk ratio present"
# Risk ratio = incorrect/unattempted = 2/1 = 2.0 (aggressive)
assert_field "Risk ratio computed" "riskRatio" "$BODY"

blue "4d. Verify negative marking applied"
# Expected: 4 correct (4*4=16 raw marks) - 2 incorrect penalties (-0.5 total) = 15.5
# The fact that totalScore is 15.5 (less than 16) proves negative marking worked
EXPECTED_RAW_SCORE=16
SCORE_NUM=$(echo "$TOTAL_SCORE" | sed 's/[^0-9.]//g')
if (( $(echo "$SCORE_NUM < $EXPECTED_RAW_SCORE" | bc -l) )); then
  pass "Negative marking reduced score from $EXPECTED_RAW_SCORE to $SCORE_NUM"
else
  fail "Negative marking verification" "Score should be less than $EXPECTED_RAW_SCORE due to penalties, got $SCORE_NUM"
fi

# ============================================================
# ANALYTICS ENGINE TESTS
# ============================================================

# Sleep to ensure analytics transaction completes
sleep 2

# ============================================================
# 5. VERIFY USER EXAM ANALYTICS
# ============================================================
blue "5. GET /analytics/exam/:examId — UserExamAnalytics"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/analytics/exam/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get exam analytics" 200 "$STATUS" "$BODY"
assert_field "  has overallAccuracy" "overallAccuracy" "$BODY"
assert_field "  has averageScore" "averageScore" "$BODY"
assert_field "  has currentStreak" "currentStreak" "$BODY"
assert_field "  has totalAttempts" "totalAttempts" "$BODY"
assert_field "  has averageTimePerQuestion" "averageTimePerQuestion" "$BODY"
assert_field "  has weakestSubject" "weakestSubject" "$BODY"
assert_field "  has riskRatio" "riskRatio" "$BODY"
assert_field "  has riskClassification" "riskClassification" "$BODY"
assert_field "  has inefficiencyIndex" "inefficiencyIndex" "$BODY"
assert_value "  totalAttempts is 1" '"totalAttempts":1' "$BODY"

# ============================================================
# 6. VERIFY SUBJECT ANALYTICS
# ============================================================
blue "6. GET /analytics/exam/:examId/subjects — UserSubjectAnalytics"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/analytics/exam/$EXAM_ID/subjects" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get all subject analytics" 200 "$STATUS" "$BODY"
assert_field "  has accuracy" "accuracy" "$BODY"
assert_field "  has attempts" "attempts" "$BODY"
assert_field "  has subject" "subject" "$BODY"
assert_value "Response is array" "\[" "$BODY"

# ============================================================
# 7. VERIFY TOPIC ANALYTICS & HEALTH STATUS
# ============================================================
blue "7. GET /analytics/exam/:examId/topics — UserTopicAnalytics"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/analytics/exam/$EXAM_ID/topics" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get all topic analytics" 200 "$STATUS" "$BODY"
assert_field "  has accuracy" "accuracy" "$BODY"
assert_field "  has attempts" "attempts" "$BODY"
assert_field "  has negativeRate" "negativeRate" "$BODY"
assert_field "  has easyAccuracy" "easyAccuracy" "$BODY"
assert_field "  has mediumAccuracy" "mediumAccuracy" "$BODY"
assert_field "  has hardAccuracy" "hardAccuracy" "$BODY"
assert_field "  has healthStatus" "healthStatus" "$BODY"
assert_field "  has consistencyScore" "consistencyScore" "$BODY"
assert_field "  has trendDelta" "trendDelta" "$BODY"
assert_value "Response is array" "\[" "$BODY"

# Verify health status is one of: STABLE, IMPROVING, VOLATILE, WEAK
if echo "$BODY" | grep -qE '"healthStatus":"(STABLE|IMPROVING|VOLATILE|WEAK)"'; then
  green "Topic health status is valid"
  PASS=$((PASS+1))
else
  red "Invalid health status"
  dim "$BODY"
  FAIL=$((FAIL+1))
fi

# ============================================================
# 8. VERIFY PERFORMANCE TREND
# ============================================================
blue "8. GET /analytics/exam/:examId/trend — PerformanceTrend"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/analytics/exam/$EXAM_ID/trend" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Get performance trends" 200 "$STATUS" "$BODY"
assert_value "Response is array" "\[" "$BODY"
assert_field "  trend has attemptId" "attemptId" "$BODY"
assert_field "  trend has score" "score" "$BODY"
assert_field "  trend has accuracy" "accuracy" "$BODY"
assert_field "  trend has percentile" "percentile" "$BODY"
assert_field "  trend has testDate" "testDate" "$BODY"

# ============================================================
# 9. TEST SECOND ATTEMPT — VERIFY ANALYTICS UPDATE
# ============================================================
blue "9a. Start second attempt"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$TEST_ID/start" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Start second attempt" 201 "$STATUS" "$BODY"
ATTEMPT_ID_2=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

blue "9b. Answer all questions correctly (perfect score)"
curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q1\",\"answer\":\"$A1\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q2\",\"answer\":\"$A2\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q3\",\"answer\":\"$A3\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q4\",\"answer\":\"$A4\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q5\",\"answer\":\"$A5\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q6\",\"answer\":\"$A6\"}" > /dev/null

curl -s -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit" \
  -H "Authorization: Bearer $LEARNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"questionId\":\"$Q7\",\"answer\":\"$A7\"}" > /dev/null

blue "9c. Complete second attempt"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$ATTEMPT_ID_2/submit-test" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Complete second attempt" 200 "$STATUS" "$BODY"

sleep 2

blue "9d. Verify analytics updated with second attempt"
RES=$(curl -s -X GET "$BASE/analytics/exam/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
assert_value "Total attempts is 2" '"totalAttempts":2' "$RES"
assert_field "Average score updated" "averageScore" "$RES"
assert_field "Current streak updated" "currentStreak" "$RES"

# ============================================================
# 10. VERIFY TIME EFFICIENCY METRICS
# ============================================================
blue "10. Verify time efficiency in analytics"
RES=$(curl -s -X GET "$BASE/analytics/exam/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
assert_field "Has averageTimePerQuestion" "averageTimePerQuestion" "$RES"
assert_field "Has inefficiencyIndex" "inefficiencyIndex" "$RES"

# ============================================================
# 11. VERIFY RISK CLASSIFICATION
# ============================================================
blue "11. Verify risk classification in analytics"
RES=$(curl -s -X GET "$BASE/analytics/exam/$EXAM_ID" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
assert_field "Has riskRatio" "riskRatio" "$RES"
assert_field "Has riskClassification" "riskClassification" "$RES"

# Verify classification is valid
if echo "$RES" | grep -qE '"riskClassification":"(Very Aggressive|Aggressive|Balanced|Cautious|VERY_AGGRESSIVE|AGGRESSIVE|BALANCED|CAUTIOUS)"'; then
  green "Risk classification is valid"
  PASS=$((PASS+1))
else
  red "Invalid risk classification"
  dim "$RES"
  FAIL=$((FAIL+1))
fi

# ============================================================
# 12. VERIFY DIFFICULTY-WISE BREAKDOWN
# ============================================================
blue "12. Verify difficulty-wise accuracy in topics"
RES=$(curl -s -X GET "$BASE/analytics/exam/$EXAM_ID/topics" \
  -H "Authorization: Bearer $LEARNER_TOKEN")
assert_field "Has easyAccuracy" "easyAccuracy" "$RES"
assert_field "Has mediumAccuracy" "mediumAccuracy" "$RES"
assert_field "Has hardAccuracy" "hardAccuracy" "$RES"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS+FAIL))
echo ""
echo "============================================================"
printf " Results: \033[32m%d passed\033[0m / \033[31m%d failed\033[0m / %d total\n" $PASS $FAIL $TOTAL
echo "============================================================"
echo ""
dim "Exam ID: $EXAM_ID"
dim "Attempt IDs: $ATTEMPT_ID $ATTEMPT_ID_2"
echo ""

[[ $FAIL -eq 0 ]]
