#!/usr/bin/env bash
# ============================================================
# Quezia — User & UserProfile endpoint smoke test
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

# ============================================================
# 0. Generate unique test identity
# ============================================================
TS=$(date +%s)
EMAIL="testuser_${TS}@quezia.dev"
USERNAME="testuser_${TS}"
PASSWORD="Test@1234"

ADMIN_EMAIL="admin_${TS}@quezia.dev"
ADMIN_USERNAME="admin_${TS}"

echo ""
echo "============================================================"
echo " Quezia User & UserProfile Endpoint Tests"
echo " User  : $EMAIL"
echo " Time  : $(date)"
echo "============================================================"

# ============================================================
# 1. REGISTER
# ============================================================
blue "1. POST /auth/register"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)

assert_status "Register new user" 201 "$STATUS" "$BODY"
assert_field  "Register returns accessToken" "accessToken" "$BODY"
assert_field  "Register returns refreshToken" "refreshToken" "$BODY"
assert_field  "Register returns user.id" "id" "$BODY"

ACCESS_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
dim "User ID: $USER_ID"

# ============================================================
# 2. DUPLICATE REGISTER (conflict)
# ============================================================
blue "2. POST /auth/register — duplicate (should 409)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"username\":\"${USERNAME}_x\",\"password\":\"$PASSWORD\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Duplicate email → 409" 409 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 3. LOGIN (valid)
# ============================================================
blue "3. POST /auth/login"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Login with valid credentials" 200 "$STATUS" "$BODY"
ACCESS_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
REFRESH_TOKEN=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

# ============================================================
# 4. LOGIN (wrong password)
# ============================================================
blue "4. POST /auth/login — wrong password (should 401)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPass\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Login bad password → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 5. GET /users/me (full profile shape)
# ============================================================
blue "5. GET /users/me"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/users/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET /users/me" 200 "$STATUS" "$BODY"
for f in id email username role isActive isEmailVerified lastLogin createdAt profile; do
  assert_field "  me has field" "$f" "$BODY"
done

# ============================================================
# 6. PATCH /users/me/context  (target exam validation — bad ID)
# ============================================================
blue "6. PATCH /users/me/context — invalid examId (should 400)"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/me/context" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetExamId":"nonexistent-exam-id","targetExamYear":2026}')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Invalid examId → 400" 400 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 7. PATCH /users/me/context  (no examId — valid partial update)
# ============================================================
blue "7. PATCH /users/me/context — clear target exam"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/me/context" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetExamYear":2027}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Context update (year only)" 200 "$STATUS" "$BODY"

# ============================================================
# 8. PATCH /users/me/profile (full profile update)
# ============================================================
blue "8. PATCH /users/me/profile"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test User",
    "displayName": "Tester",
    "country": "NG",
    "timezone": "Africa/Lagos",
    "preferredLanguage": "en",
    "preparationStage": "BEGINNER",
    "studyGoal": "Pass JAMB 2027",
    "preferredSubjects": ["Mathematics","English"],
    "preferredDifficultyBias": "MEDIUM",
    "dailyStudyTimeTargetMinutes": 90,
    "notificationPreferences": {"email": true, "push": false},
    "onboardingStep": 2
  }')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Full profile update" 200 "$STATUS" "$BODY"

# ============================================================
# 9. PATCH /users/me/profile — advance onboarding completion
# ============================================================
blue "9. PATCH /users/me/profile — mark onboarding complete"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"onboardingCompleted": true, "onboardingStep": 5}')
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Onboarding completion" 200 "$STATUS" "$BODY"

# ============================================================
# 10. EMAIL VERIFICATION — resend (authenticated)
# ============================================================
blue "10. POST /auth/resend-verification"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/resend-verification" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Resend verification email" 200 "$STATUS" "$BODY"
assert_field "Resend has message" "message" "$BODY"

# Grab the token from DB via a direct check (we substitute fake token to get proper 400)
blue "10b. POST /auth/verify-email — bad token (should 400)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/verify-email" \
  -H "Content-Type: application/json" \
  -d '{"token":"definitely-not-a-real-token"}')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Bad verify token → 400" 400 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 11. TOKEN REFRESH
# ============================================================
blue "11. POST /auth/refresh"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Token refresh" 200 "$STATUS" "$BODY"
assert_field "Refresh returns new accessToken" "accessToken" "$BODY"
NEW_ACCESS=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
NEW_REFRESH=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

# Old refresh token must now be invalid (rotation)
blue "11b. POST /auth/refresh — reuse old token (should 401)"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Old refresh token rejected → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 12. FORGOT PASSWORD
# ============================================================
blue "12. POST /auth/forgot-password"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Forgot password (always 200)" 200 "$STATUS" "$(echo "$RES" | sed '$d')"

# Non-existent email also returns 200 (anti-enumeration)
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@nowhere.dev"}')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Forgot password unknown email → 200 (anti-enum)" 200 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 13. ADMIN — suspend/activate (no admin token = 403)
# ============================================================
blue "13. PATCH /users/:id/suspend — non-admin (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/$USER_ID/suspend" \
  -H "Authorization: Bearer $NEW_ACCESS")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Suspend without admin role → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

blue "13b. PATCH /users/:id/activate — non-admin (should 403)"
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/users/$USER_ID/activate" \
  -H "Authorization: Bearer $NEW_ACCESS")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Activate without admin role → 403" 403 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 14. LOGOUT
# ============================================================
blue "14. POST /auth/logout"
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/logout" \
  -H "Authorization: Bearer $NEW_ACCESS" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH\"}")
BODY=$(echo "$RES" | sed '$d')
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Logout" 200 "$STATUS" "$BODY"
assert_field "Logout has message" "message" "$BODY"

# After logout the old token should still pass JWT verify (stateless access token)
# but the refresh should be dead
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH\"}")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "Refresh after logout → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# 15. Unauthenticated access (should 401)
# ============================================================
blue "15. GET /users/me — no token (should 401)"
RES=$(curl -s -w "\n%{http_code}" -X GET "$BASE/users/me")
STATUS=$(echo "$RES" | tail -n 1)
assert_status "GET /users/me unauthenticated → 401" 401 "$STATUS" "$(echo "$RES" | sed '$d')"

# ============================================================
# Summary
# ============================================================
TOTAL=$((PASS+FAIL))
echo ""
echo "============================================================"
printf " Results: \033[32m%d passed\033[0m / \033[31m%d failed\033[0m / %d total\n" $PASS $FAIL $TOTAL
echo "============================================================"
echo ""

[[ $FAIL -eq 0 ]]
