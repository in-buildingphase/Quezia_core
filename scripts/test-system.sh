#!/usr/bin/env bash
# =============================================================================
#
#   ██████╗ ██╗   ██╗███████╗███████╗██╗ █████╗
#  ██╔═══██╗██║   ██║██╔════╝╚══███╔╝██║██╔══██╗
#  ██║   ██║██║   ██║█████╗    ███╔╝ ██║███████║
#  ██║▄▄ ██║██║   ██║██╔══╝   ███╔╝  ██║██╔══██║
#  ╚██████╔╝╚██████╔╝███████╗███████╗██║██║  ██║
#   ╚══▀▀═╝  ╚═════╝ ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝
#
#   System Integration Test Suite
#   Tests every module end-to-end against a live server
#
# =============================================================================

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@quezia.com}"
ADMIN_PASS="${ADMIN_PASS:-Admin123!}"

# ─── Colours & Symbols ────────────────────────────────────────────────────────
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_DIM="\033[2m"
C_RED="\033[31m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_BLUE="\033[34m"
C_MAGENTA="\033[35m"
C_CYAN="\033[36m"
C_WHITE="\033[97m"
C_BG_RED="\033[41m"
C_BG_GREEN="\033[42m"
C_BG_BLUE="\033[44m"
C_BG_MAGENTA="\033[45m"

SYM_PASS="✔"
SYM_FAIL="✘"
SYM_WARN="⚠"
SYM_ARROW="▶"
SYM_DOT="·"

# ─── Global Counters ──────────────────────────────────────────────────────────
TOTAL_PASS=0
TOTAL_FAIL=0
declare -a SECTION_NAMES=()
declare -a SECTION_PASS=()
declare -a SECTION_FAIL=()
declare -a FAILURES=()   # "SECTION_NAME|STEP|ENDPOINT|EXPECTED|ACTUAL|BODY"

CURRENT_SECTION=""
SECTION_P=0
SECTION_F=0
SECTION_START=0

TS=$(date +%s)
SUITE_START=$SECONDS

# ─── Print Helpers ────────────────────────────────────────────────────────────
pass()    { printf "${C_GREEN}  ${SYM_PASS}  ${C_RESET}%s\n" "$*"; }
fail()    { printf "${C_RED}  ${SYM_FAIL}  ${C_RESET}${C_BOLD}%s${C_RESET}\n" "$*"; }
warn()    { printf "${C_YELLOW}  ${SYM_WARN}  ${C_RESET}%s\n" "$*"; }
step()    { printf "\n${C_CYAN}  ${SYM_ARROW} ${C_BOLD}%s${C_RESET}\n" "$*"; }
info()    { printf "     ${C_DIM}%s${C_RESET}\n" "$*"; }
endpoint(){ printf "     ${C_DIM}%-8s${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$1" "$2"; }
blank()   { echo ""; }

# Print a trimmed response body for failure context (max 120 chars)
body_preview() {
  local body="$1"
  local preview
  preview=$(echo "$body" | tr -d '\n' | head -c 140)
  [[ ${#preview} -ge 140 ]] && preview="${preview}…"
  printf "     ${C_DIM}Response: %s${C_RESET}\n" "$preview"
}

# Section banner
section_banner() {
  local icon="$1" title="$2"
  blank
  printf "${C_BG_BLUE}${C_WHITE}${C_BOLD}  %s  %-60s  ${C_RESET}\n" "$icon" "$title"
}

# End-of-section mini-summary
section_end() {
  local elapsed=$(( SECONDS - SECTION_START ))
  local total=$(( SECTION_P + SECTION_F ))
  blank
  if [[ $SECTION_F -eq 0 ]]; then
    printf "  ${C_GREEN}${C_BOLD}All %d tests passed${C_RESET}${C_DIM}  (%ds)${C_RESET}\n" \
      "$total" "$elapsed"
  else
    printf "  ${C_RED}${C_BOLD}%d/%d failed${C_RESET}${C_DIM}  (%ds)${C_RESET}\n" \
      "$SECTION_F" "$total" "$elapsed"
  fi
  SECTION_NAMES+=("$CURRENT_SECTION")
  SECTION_PASS+=("$SECTION_P")
  SECTION_FAIL+=("$SECTION_F")
  TOTAL_PASS=$(( TOTAL_PASS + SECTION_P ))
  TOTAL_FAIL=$(( TOTAL_FAIL + SECTION_F ))
  SECTION_P=0
  SECTION_F=0
}

begin_section() {
  local icon="$1" title="$2"
  CURRENT_SECTION="$title"
  SECTION_P=0
  SECTION_F=0
  SECTION_START=$SECONDS
  section_banner "$icon" "$title"
}

# ─── Core Assertion Engine ────────────────────────────────────────────────────
LAST_STEP=""
LAST_METHOD=""
LAST_PATH=""

# Call before each request: track_request "STEP LABEL" "METHOD" "/path"
track() { LAST_STEP="$1"; LAST_METHOD="${2:-}"; LAST_PATH="${3:-}"; }

assert_http() {
  local label="$1" expected="$2" actual="$3" body="$4"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label  ${C_DIM}HTTP $actual${C_RESET}"
    SECTION_P=$(( SECTION_P+1 ))
  else
    fail "$label  ${C_DIM}HTTP $actual (expected $expected)${C_RESET}"
    body_preview "$body"
    SECTION_F=$(( SECTION_F+1 ))
    FAILURES+=("${CURRENT_SECTION}|${label}|${LAST_METHOD} ${LAST_PATH}|${expected}|${actual}|$(echo "$body" | head -c 120 | tr '\n' ' ')")
  fi
}

assert_field() {
  local label="$1" field="$2" body="$3"
  if echo "$body" | grep -q "\"$field\""; then
    pass "$label  ${C_DIM}has '$field'${C_RESET}"
    SECTION_P=$(( SECTION_P+1 ))
  else
    fail "$label  ${C_DIM}field '$field' missing${C_RESET}"
    body_preview "$body"
    SECTION_F=$(( SECTION_F+1 ))
    FAILURES+=("${CURRENT_SECTION}|${label} (field: ${field})|${LAST_METHOD} ${LAST_PATH}|present|missing|$(echo "$body" | head -c 120 | tr '\n' ' ')")
  fi
}

assert_contains() {
  local label="$1" needle="$2" body="$3"
  if echo "$body" | grep -q "$needle"; then
    pass "$label"
    SECTION_P=$(( SECTION_P+1 ))
  else
    fail "$label  ${C_DIM}expected '${needle}'${C_RESET}"
    body_preview "$body"
    SECTION_F=$(( SECTION_F+1 ))
    FAILURES+=("${CURRENT_SECTION}|${label}|${LAST_METHOD} ${LAST_PATH}|contains '${needle}'|not found|$(echo "$body" | head -c 120 | tr '\n' ' ')")
  fi
}

# curl wrapper: returns "BODY\nHTTP_CODE"
do_req() {
  curl -s -w "\n%{http_code}" "$@"
}
parse_body()   { echo "$1" | sed '$d'; }
parse_status() { echo "$1" | tail -n 1; }

# ─── Abort helper ─────────────────────────────────────────────────────────────
abort() {
  blank
  printf "${C_BG_RED}${C_WHITE}${C_BOLD}  FATAL: %s  ${C_RESET}\n" "$1"
  printf "  ${C_DIM}%s${C_RESET}\n" "${2:-}"
  blank
  exit 1
}

# =============================================================================
#  SERVER HEALTH CHECK
# =============================================================================
print_banner() {
  clear
  printf "${C_BOLD}${C_CYAN}"
  cat << 'EOF'

  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   ██████╗ ██╗   ██╗███████╗███████╗██╗ █████╗            ║
  ║  ██╔═══██╗██║   ██║██╔════╝╚══███╔╝██║██╔══██╗           ║
  ║  ██║   ██║██║   ██║█████╗    ███╔╝ ██║███████║           ║
  ║  ██║▄▄ ██║██║   ██║██╔══╝   ███╔╝  ██║██╔══██║           ║
  ║  ╚██████╔╝╚██████╔╝███████╗███████╗██║██║  ██║           ║
  ║   ╚══▀▀═╝  ╚═════╝ ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝           ║
  ║                                                           ║
  ║         System Integration Test Suite v1.0               ║
  ╚═══════════════════════════════════════════════════════════╝
EOF
  printf "${C_RESET}"
  printf "  ${C_DIM}Target : ${C_WHITE}%s${C_RESET}\n" "$BASE"
  printf "  ${C_DIM}Time   : %s${C_RESET}\n" "$(date)"
  printf "  ${C_DIM}Run ID : %s${C_RESET}\n" "$TS"
  blank
}

check_server() {
  printf "  ${C_YELLOW}Checking server at %s …${C_RESET}\n" "$BASE"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/health" 2>/dev/null || echo "000")
  if [[ "$http_code" == "200" ]]; then
    printf "  ${C_GREEN}${SYM_PASS}  Server is up (HTTP 200)${C_RESET}\n"
  elif [[ "$http_code" == "000" ]]; then
    abort "Server not reachable at $BASE" "Start with: node dist/src/main.js"
  else
    printf "  ${C_YELLOW}${SYM_WARN}  Server responded HTTP $http_code — proceeding${C_RESET}\n"
  fi
}

# =============================================================================
#  § 1  AUTH & USERS
# =============================================================================
run_auth_users() {
  begin_section "👤" "Auth & Users"

  local EMAIL="sys_user_${TS}@quezia.dev"
  local USERNAME="sys_user_${TS}"
  local PASSWORD="Test@1234"
  local ACCESS_TOKEN REFRESH_TOKEN USER_ID NEW_ACCESS NEW_REFRESH

  # ── 1. Register ───────────────────────────────────────────
  step "1. POST /auth/register — new user"
  endpoint "POST" "/auth/register"
  track "Register" "POST" "/auth/register"
  local RES BODY STATUS
  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Register new user"         201 "$STATUS" "$BODY"
  assert_field "  has accessToken"         "accessToken"  "$BODY"
  assert_field "  has refreshToken"        "refreshToken" "$BODY"
  assert_field "  has user id"             "id"           "$BODY"
  ACCESS_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  REFRESH_TOKEN=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)
  USER_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "User ID: $USER_ID"

  # ── 2. Duplicate register → 409 ───────────────────────────
  step "2. POST /auth/register — duplicate email → 409"
  endpoint "POST" "/auth/register"
  track "Duplicate register" "POST" "/auth/register"
  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"username\":\"${USERNAME}_x\",\"password\":\"$PASSWORD\"}")
  STATUS=$(parse_status "$RES")
  assert_http "Duplicate email rejected" 409 "$STATUS" "$(parse_body "$RES")"

  # ── 3. Login valid ────────────────────────────────────────
  step "3. POST /auth/login — valid credentials"
  endpoint "POST" "/auth/login"
  track "Login" "POST" "/auth/login"
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Login valid credentials"   200 "$STATUS" "$BODY"
  ACCESS_TOKEN=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  REFRESH_TOKEN=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

  # ── 4. Login bad password → 401 ───────────────────────────
  step "4. POST /auth/login — wrong password → 401"
  endpoint "POST" "/auth/login"
  track "Login bad password" "POST" "/auth/login"
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Wrong!\"}")
  STATUS=$(parse_status "$RES")
  assert_http "Wrong password rejected" 401 "$STATUS" "$(parse_body "$RES")"

  # ── 5. GET /users/me ──────────────────────────────────────
  step "5. GET /users/me — full profile"
  endpoint "GET" "/users/me"
  track "GET me" "GET" "/users/me"
  RES=$(do_req -X GET "$BASE/users/me" -H "Authorization: Bearer $ACCESS_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET /users/me"    200 "$STATUS" "$BODY"
  for f in id email username role isActive isEmailVerified lastLogin createdAt profile; do
    assert_field "  has $f" "$f" "$BODY"
  done

  # ── 6. Profile update ───────────────────────────────────
  step "6. PATCH /users/me/profile — update profile"
  endpoint "PATCH" "/users/me/profile"
  track "Profile update" "PATCH" "/users/me/profile"
  RES=$(do_req -X PATCH "$BASE/users/me/profile" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"fullName":"System Tester","country":"NG","preparationStage":"BEGINNER","dailyStudyTimeTargetMinutes":60}')
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Profile updated"       200 "$STATUS" "$BODY"

  # ── 7. Context update ──────────────────────────────────
  step "7. PATCH /users/me/context — year only"
  endpoint "PATCH" "/users/me/context"
  track "Context update" "PATCH" "/users/me/context"
  RES=$(do_req -X PATCH "$BASE/users/me/context" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"targetExamYear":2027}')
  STATUS=$(parse_status "$RES")
  assert_http "Context year update" 200 "$STATUS" "$(parse_body "$RES")"

  # ── 7b. Invalid examId context → 400 ─────────────────────
  step "7b. PATCH /users/me/context — invalid examId → 400"
  endpoint "PATCH" "/users/me/context"
  track "Context invalid examId" "PATCH" "/users/me/context"
  RES=$(do_req -X PATCH "$BASE/users/me/context" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"targetExamId":"nonexistent-exam-id","targetExamYear":2026}')
  STATUS=$(parse_status "$RES")
  assert_http "Invalid examId context → 400" 400 "$STATUS" "$(parse_body "$RES")"

  # ── 8. Resend verification ────────────────────────────────
  step "8. POST /auth/resend-verification"
  endpoint "POST" "/auth/resend-verification"
  track "Resend verification" "POST" "/auth/resend-verification"
  RES=$(do_req -X POST "$BASE/auth/resend-verification" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  STATUS=$(parse_status "$RES")
  assert_http "Resend verification email" 200 "$STATUS" "$(parse_body "$RES")"

  # ── 9. Bad verify token → 400 ─────────────────────────────
  step "9. POST /auth/verify-email — bad token → 400"
  endpoint "POST" "/auth/verify-email"
  track "Bad verify token" "POST" "/auth/verify-email"
  RES=$(do_req -X POST "$BASE/auth/verify-email" \
    -H "Content-Type: application/json" \
    -d '{"token":"not-a-real-token"}')
  STATUS=$(parse_status "$RES")
  assert_http "Bad verify token rejected" 400 "$STATUS" "$(parse_body "$RES")"

  # ── 10. Token refresh ─────────────────────────────────────
  step "10. POST /auth/refresh — rotate token"
  endpoint "POST" "/auth/refresh"
  track "Token refresh" "POST" "/auth/refresh"
  RES=$(do_req -X POST "$BASE/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Token refresh"            200 "$STATUS" "$BODY"
  assert_field "  new accessToken issued" "accessToken" "$BODY"
  NEW_ACCESS=$(echo "$BODY" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  NEW_REFRESH=$(echo "$BODY" | grep -o '"refreshToken":"[^"]*"' | cut -d'"' -f4)

  # Old token rejected (rotation)
  track "Old refresh token reuse" "POST" "/auth/refresh"
  RES=$(do_req -X POST "$BASE/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
  STATUS=$(parse_status "$RES")
  assert_http "Old token rejected after rotation" 401 "$STATUS" "$(parse_body "$RES")"

  # ── 11. Forgot password (anti-enumeration) ────────────────
  step "11. POST /auth/forgot-password — anti-enumeration"
  endpoint "POST" "/auth/forgot-password"
  track "Forgot password" "POST" "/auth/forgot-password"
  for em in "$EMAIL" "ghost@nowhere.dev"; do
    RES=$(do_req -X POST "$BASE/auth/forgot-password" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$em\"}")
    STATUS=$(parse_status "$RES")
    assert_http "Forgot password always 200 ($em)" 200 "$STATUS" "$(parse_body "$RES")"
  done

  # ── 12. Role guard – suspend without admin ────────────────
  step "12. Role guard — suspend/activate require ADMIN"
  endpoint "POST" "/admin/users/:id/suspend"
  track "Suspend non-admin" "POST" "/admin/users/:id/suspend"
  RES=$(do_req -X POST "$BASE/admin/users/$USER_ID/suspend" \
    -H "Authorization: Bearer $NEW_ACCESS")
  STATUS=$(parse_status "$RES")
  assert_http "Suspend without admin → 403" 403 "$STATUS" "$(parse_body "$RES")"

  # ── 13. Logout ────────────────────────────────────────────
  step "13. POST /auth/logout"
  endpoint "POST" "/auth/logout"
  track "Logout" "POST" "/auth/logout"
  RES=$(do_req -X POST "$BASE/auth/logout" \
    -H "Authorization: Bearer $NEW_ACCESS" \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$NEW_REFRESH\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Logout"           200 "$STATUS" "$BODY"
  assert_field "  has message"    "message" "$BODY"

  track "Refresh after logout" "POST" "/auth/refresh"
  RES=$(do_req -X POST "$BASE/auth/refresh" \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$NEW_REFRESH\"}")
  STATUS=$(parse_status "$RES")
  assert_http "Refresh after logout → 401" 401 "$STATUS" "$(parse_body "$RES")"

  # ── 14. Unauthenticated access ────────────────────────────
  step "14. GET /users/me — unauthenticated → 401"
  endpoint "GET" "/users/me"
  track "Unauthenticated" "GET" "/users/me"
  RES=$(do_req -X GET "$BASE/users/me")
  STATUS=$(parse_status "$RES")
  assert_http "No token rejected" 401 "$STATUS" "$(parse_body "$RES")"

  section_end
}

# =============================================================================
#  § 2  EXAMS & BLUEPRINTS
# =============================================================================
run_exams_blueprints() {
  begin_section "📋" "Exams & Blueprints"

  local EXAM_NAME="SYSEXAM_${TS}"
  local LEARNER_EMAIL="sys_exam_learner_${TS}@quezia.dev"
  local LEARNER_TOKEN EXAM_ID BLUEPRINT_ID BP2_ID
  local RES BODY STATUS

  # Tokens
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  local ADMIN_TOKEN
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  [[ -z "$ADMIN_TOKEN" ]] && abort "Admin login failed" "Seed admin: npx ts-node -r tsconfig-paths/register scripts/create-admin.ts"

  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$LEARNER_EMAIL\",\"username\":\"sys_exam_l_${TS}\",\"password\":\"Test@1234\"}")
  LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  # ── 1. Create exam ─────────────────────────────────────────
  step "1. POST /exams — create exam (admin)"
  endpoint "POST" "/exams"
  track "Create exam" "POST" "/exams"
  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$EXAM_NAME\",\"description\":\"System test exam\",\"isActive\":true}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Create exam (admin)"     201 "$STATUS" "$BODY"
  assert_field "  has id"               "id"       "$BODY"
  assert_field "  has name"             "name"     "$BODY"
  assert_field "  has isActive"         "isActive" "$BODY"
  EXAM_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Exam ID: $EXAM_ID"

  # ── 2. Learner create exam → 403 ──────────────────────────
  step "2. POST /exams — learner → 403"
  endpoint "POST" "/exams"
  track "Learner create exam" "POST" "/exams"
  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${EXAM_NAME}_x\",\"isActive\":true}")
  assert_http "Learner create exam rejected" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 3. Unauthenticated create → 401 ─────────────────────
  step "3. POST /exams — no token → 401"
  endpoint "POST" "/exams"
  track "Unauth create exam" "POST" "/exams"
  RES=$(do_req -X POST "$BASE/exams" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${EXAM_NAME}_y\",\"isActive\":true}")
  assert_http "Unauth create exam rejected" 401 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 4. GET all exams ──────────────────────────────────────
  step "4. GET /exams"
  endpoint "GET" "/exams"
  track "GET exams" "GET" "/exams"
  RES=$(do_req -X GET "$BASE/exams" -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET /exams"                200 "$STATUS" "$BODY"
  assert_contains "  returns array"          "\[" "$BODY"

  # ── 5. GET exam by ID ─────────────────────────────────────
  step "5. GET /exams/:id"
  endpoint "GET" "/exams/:id"
  track "GET exam by id" "GET" "/exams/:id"
  RES=$(do_req -X GET "$BASE/exams/$EXAM_ID" -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET exam by id"          200 "$STATUS" "$BODY"
  assert_field "  has blueprints array"  "blueprints"  "$BODY"

  # ── 6. GET exam not found → 404 ───────────────────────────
  step "6. GET /exams/nonexistent → 404"
  endpoint "GET" "/exams/nonexistent-id-xyz"
  track "GET exam 404" "GET" "/exams/nonexistent-id-xyz"
  RES=$(do_req -X GET "$BASE/exams/nonexistent-id-xyz" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  assert_http "Nonexistent exam 404" 404 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 7. PATCH exam ─────────────────────────────────────────
  step "7. PATCH /exams/:id — update description"
  endpoint "PATCH" "/exams/:id"
  track "PATCH exam" "PATCH" "/exams/:id"
  RES=$(do_req -X PATCH "$BASE/exams/$EXAM_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"description":"Updated in system test"}')
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Update exam"                200 "$STATUS" "$BODY"
  assert_contains "  description updated"     "Updated in system test" "$BODY"

  # ── 8. Deactivate / reactivate ────────────────────────────
  step "8. PATCH /exams/:id — deactivate then reactivate"
  endpoint "PATCH" "/exams/:id"
  for active in false true; do
    track "Toggle exam active=$active" "PATCH" "/exams/:id"
    RES=$(do_req -X PATCH "$BASE/exams/$EXAM_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"isActive\":$active}")
    STATUS=$(parse_status "$RES")
    assert_http "Set isActive=$active" 200 "$STATUS" "$(parse_body "$RES")"
  done

  # ── 9. Create blueprint ───────────────────────────────────
  step "9. POST /exams/:id/blueprints — create blueprint"
  endpoint "POST" "/exams/:id/blueprints"
  track "Create blueprint" "POST" "/exams/:id/blueprints"
  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"version\": 1,
      \"defaultDurationSeconds\": 7200,
      \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\",
      \"sections\": [
        {\"subject\": \"Math\",      \"sequence\": 1, \"sectionDurationSeconds\": 1800},
        {\"subject\": \"Physics\",   \"sequence\": 2},
        {\"subject\": \"Chemistry\", \"sequence\": 3}
      ],
      \"rules\": [{
        \"totalTimeSeconds\": 7200,
        \"negativeMarking\": true,
        \"negativeMarkValue\": 0.25,
        \"partialMarking\": false,
        \"adaptiveAllowed\": false,
        \"effectiveFrom\": \"2025-01-01T00:00:00.000Z\"
      }]
    }")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Create blueprint"     201 "$STATUS" "$BODY"
  assert_field "  has id"             "id"       "$BODY"
  assert_field "  has sections"       "sections" "$BODY"
  assert_field "  has rules"          "rules"    "$BODY"
  assert_field "  has version"        "version"  "$BODY"
  BLUEPRINT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Blueprint ID: $BLUEPRINT_ID"

  # ── 10. Blueprint missing version → 400 ──────────────────
  step "10. POST /exams/:id/blueprints — missing version → 400"
  endpoint "POST" "/exams/:id/blueprints"
  track "Blueprint missing version" "POST" "/exams/:id/blueprints"
  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[],\"rules\":[]}")
  assert_http "Missing version → 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 11. Blueprint nonexistent exam → 404 ─────────────────
  step "11. POST /exams/nonexistent/blueprints → 404"
  endpoint "POST" "/exams/nonexistent/blueprints"
  track "Blueprint nonexistent exam" "POST" "/exams/nonexistent/blueprints"
  RES=$(do_req -X POST "$BASE/exams/nonexistent-exam/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":99,\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[],\"rules\":[]}")
  assert_http "Blueprint nonexistent exam 404" 404 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 12. GET blueprint ─────────────────────────────────────
  step "12. GET /exams/blueprints/:id"
  endpoint "GET" "/exams/blueprints/:id"
  track "GET blueprint" "GET" "/exams/blueprints/:id"
  RES=$(do_req -X GET "$BASE/exams/blueprints/$BLUEPRINT_ID" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET blueprint"    200 "$STATUS" "$BODY"
  assert_field "  has sections"  "sections" "$BODY"
  assert_field "  has rules"     "rules"    "$BODY"

  # ── 12b. GET blueprint nonexistent → 404 ─────────────────
  step "12b. GET /exams/blueprints/nonexistent-bp → 404"
  endpoint "GET" "/exams/blueprints/nonexistent-bp"
  track "GET blueprint 404" "GET" "/exams/blueprints/nonexistent-bp"
  RES=$(do_req -X GET "$BASE/exams/blueprints/nonexistent-bp" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "GET nonexistent blueprint 404" 404 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 13. GET active blueprint ──────────────────────────────
  step "13. GET /exams/:id/blueprints/active"
  endpoint "GET" "/exams/:id/blueprints/active"
  track "GET active blueprint" "GET" "/exams/:id/blueprints/active"
  RES=$(do_req -X GET "$BASE/exams/$EXAM_ID/blueprints/active" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET active blueprint"   200 "$STATUS" "$BODY"
  assert_field "  has id"               "id" "$BODY"

  # ── 14. Activate blueprint ────────────────────────────────
  step "14. POST /exams/blueprints/:id/activate"
  endpoint "POST" "/exams/blueprints/:id/activate"
  track "Activate blueprint" "POST" "/exams/blueprints/:id/activate"
  RES=$(do_req -X POST "$BASE/exams/blueprints/$BLUEPRINT_ID/activate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"effectiveFrom":"2025-01-01T00:00:00.000Z","effectiveTo":"2030-01-01T00:00:00.000Z"}')
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Activate blueprint"      201 "$STATUS" "$BODY"
  assert_contains "  effectiveTo set"      "effectiveTo" "$BODY"

  # ── 15. Activate blueprint — learner → 403 ────────────────
  step "15. POST /exams/blueprints/:id/activate — learner → 403"
  endpoint "POST" "/exams/blueprints/:id/activate"
  track "Learner activate blueprint" "POST" "/exams/blueprints/:id/activate"
  RES=$(do_req -X POST "$BASE/exams/blueprints/$BLUEPRINT_ID/activate" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"effectiveFrom":"2025-01-01T00:00:00.000Z"}')
  assert_http "Learner activate blueprint 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 16. Archive blueprint ─────────────────────────────────
  step "16. Create second blueprint + archive it"
  endpoint "POST" "/exams/:id/blueprints"
  track "Create second blueprint" "POST" "/exams/:id/blueprints"
  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":2,\"defaultDurationSeconds\":5400,\"effectiveFrom\":\"2024-01-01T00:00:00.000Z\",\"sections\":[{\"subject\":\"Chemistry\",\"sequence\":1}],\"rules\":[{\"totalTimeSeconds\":5400,\"negativeMarking\":false,\"partialMarking\":false,\"adaptiveAllowed\":true,\"effectiveFrom\":\"2024-01-01T00:00:00.000Z\"}]}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Create second blueprint" 201 "$STATUS" "$BODY"
  BP2_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  track "Archive blueprint" "POST" "/exams/blueprints/:id/archive"
  RES=$(do_req -X POST "$BASE/exams/blueprints/$BP2_ID/archive" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Archive blueprint"         201 "$STATUS" "$BODY"
  assert_field "  has effectiveTo"         "effectiveTo" "$BODY"

  # ── 16b. Archive blueprint — learner → 403 ───────────────
  track "Learner archive blueprint" "POST" "/exams/blueprints/:id/archive"
  RES=$(do_req -X POST "$BASE/exams/blueprints/$BLUEPRINT_ID/archive" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Learner archive blueprint 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  info "Exam ID kept: $EXAM_ID  |  Blueprint ID: $BLUEPRINT_ID"
  # Export for later sections
  export SYS_EXAM_ID="$EXAM_ID"
  export SYS_BLUEPRINT_ID="$BLUEPRINT_ID"
  export SYS_ADMIN_TOKEN="$ADMIN_TOKEN"

  section_end
}

# =============================================================================
#  § 3  SUBSCRIPTIONS
# =============================================================================
run_subscriptions() {
  begin_section "💳" "Subscriptions"

  local EXAM_NAME="SYSSUB_${TS}"
  local L1_EMAIL="sys_sub1_${TS}@quezia.dev" L1_USER="sys_sub1_${TS}"
  local L2_EMAIL="sys_sub2_${TS}@quezia.dev" L2_USER="sys_sub2_${TS}"
  local ADMIN_TOKEN LEARNER_TOKEN LEARNER2_TOKEN
  local EXAM_ID PACK_ID ACTIVE_PACK_ID SUB_ID RENEWED_SUB_ID
  local RES BODY STATUS

  # Tokens
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  for pair in "$L1_EMAIL:$L1_USER" "$L2_EMAIL:$L2_USER"; do
    local em="${pair%%:*}" un="${pair##*:}"
    RES=$(do_req -X POST "$BASE/auth/register" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$em\",\"username\":\"$un\",\"password\":\"Test@1234\"}")
    if [[ "$un" == "$L1_USER" ]]; then
      LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
      LEARNER_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    else
      LEARNER2_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
      LEARNER2_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
  done

  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Sub test\",\"isActive\":true}")
  EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── 1. Create pack ─────────────────────────────────────────
  step "1. POST /subscriptions/packs — create (admin)"
  endpoint "POST" "/subscriptions/packs"
  track "Create pack" "POST" "/subscriptions/packs"
  RES=$(do_req -X POST "$BASE/subscriptions/packs" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"name\":\"30-Day Pass\",\"durationDays\":30,\"price\":2500,\"isActive\":true}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Create subscription pack"  201 "$STATUS" "$BODY"
  assert_field "  has id"                  "id"          "$BODY"
  assert_field "  has durationDays"        "durationDays" "$BODY"
  assert_field "  has price"               "price"        "$BODY"
  PACK_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Pack ID: $PACK_ID"

  # ── 2. Guard tests ────────────────────────────────────────
  step "2. Pack guards — 404 / 403 / 401"
  endpoint "POST" "/subscriptions/packs"
  for test_case in "nonexistent:404" "learner:403" "noauth:401"; do
    local tc_key="${test_case%%:*}" tc_expected="${test_case##*:}"
    local tc_token tc_exam
    case "$tc_key" in
      nonexistent) tc_token="$ADMIN_TOKEN";   tc_exam="nonexistent-exam-id" ;;
      learner)     tc_token="$LEARNER_TOKEN"; tc_exam="$EXAM_ID" ;;
      noauth)      tc_token="";               tc_exam="$EXAM_ID" ;;
    esac
    local tc_cmd=(-X POST "$BASE/subscriptions/packs" -H "Content-Type: application/json" \
      -d "{\"examId\":\"$tc_exam\",\"name\":\"X\",\"durationDays\":1,\"price\":1}")
    [[ -n "$tc_token" ]] && tc_cmd+=(-H "Authorization: Bearer $tc_token")
    track "Pack guard $tc_key" "POST" "/subscriptions/packs"
    RES=$(do_req "${tc_cmd[@]}")
    assert_http "  Pack guard: $tc_key → $tc_expected" "$tc_expected" "$(parse_status "$RES")" "$(parse_body "$RES")"
  done

  # ── 3. GET packs ──────────────────────────────────────────
  step "3. GET /subscriptions/packs"
  endpoint "GET" "/subscriptions/packs"
  track "GET packs" "GET" "/subscriptions/packs"
  RES=$(do_req -X GET "$BASE/subscriptions/packs" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET all packs"     200 "$STATUS" "$BODY"
  assert_contains "  returns array"  "\[" "$BODY"

  # ── 4. GET packs by exam ──────────────────────────────────
  step "4. GET /subscriptions/packs/exam/:examId"
  endpoint "GET" "/subscriptions/packs/exam/:examId"
  track "GET packs by exam" "GET" "/subscriptions/packs/exam/:examId"
  RES=$(do_req -X GET "$BASE/subscriptions/packs/exam/$EXAM_ID" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET packs by exam"    200 "$STATUS" "$BODY"
  assert_contains "  contains our pack" "$PACK_ID" "$BODY"

  # ── 5. Toggle pack (disable) ──────────────────────────────
  step "5. PATCH /subscriptions/packs/:id/toggle — disable"
  endpoint "PATCH" "/subscriptions/packs/:id/toggle"
  track "Toggle pack off" "PATCH" "/subscriptions/packs/:id/toggle"
  RES=$(do_req -X PATCH "$BASE/subscriptions/packs/$PACK_ID/toggle" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Toggle pack off"          200 "$STATUS" "$BODY"
  assert_contains "  isActive=false"        '"isActive":false' "$BODY"

  # ── 5b. GET pack by ID ────────────────────────────────────
  step "5b. GET /subscriptions/packs/:id — by ID"
  endpoint "GET" "/subscriptions/packs/:id"
  track "GET pack by id" "GET" "/subscriptions/packs/:id"
  RES=$(do_req -X GET "$BASE/subscriptions/packs/$PACK_ID" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET pack by id"  200 "$STATUS" "$BODY"
  assert_field "  has exam"      "exam" "$BODY"

  # ── 5c. GET pack nonexistent → 404 ───────────────────────
  step "5c. GET /subscriptions/packs/nonexistent → 404"
  endpoint "GET" "/subscriptions/packs/nonexistent"
  track "GET pack 404" "GET" "/subscriptions/packs/nonexistent"
  RES=$(do_req -X GET "$BASE/subscriptions/packs/nonexistent-pack-id" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "GET nonexistent pack 404" 404 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 5d. PATCH pack — update price/duration ────────────────
  step "5d. PATCH /subscriptions/packs/:id — update price"
  endpoint "PATCH" "/subscriptions/packs/:id"
  track "PATCH pack" "PATCH" "/subscriptions/packs/:id"
  RES=$(do_req -X PATCH "$BASE/subscriptions/packs/$PACK_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"price":3000,"durationDays":45}')
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "PATCH pack price"    200 "$STATUS" "$BODY"
  assert_field "  has durationDays"  "durationDays" "$BODY"

  # ── 6. Create active pack ─────────────────────────────────
  step "6. Create active pack for subscribe flow"
  endpoint "POST" "/subscriptions/packs"
  track "Create active pack" "POST" "/subscriptions/packs"
  RES=$(do_req -X POST "$BASE/subscriptions/packs" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"name\":\"90-Day Pass\",\"durationDays\":90,\"price\":5000,\"isActive\":true}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Create active pack" 201 "$STATUS" "$BODY"
  ACTIVE_PACK_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Active Pack ID: $ACTIVE_PACK_ID"

  # ── 7. Subscribe to inactive pack → 400 ──────────────────
  step "7. POST /subscriptions/subscribe — inactive pack → 400"
  endpoint "POST" "/subscriptions/subscribe"
  track "Subscribe inactive pack" "POST" "/subscriptions/subscribe"
  RES=$(do_req -X POST "$BASE/subscriptions/subscribe" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"packId\":\"$PACK_ID\"}")
  assert_http "Subscribe inactive pack 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 8. Subscribe (valid) ──────────────────────────────────
  step "8. POST /subscriptions/subscribe — active pack"
  endpoint "POST" "/subscriptions/subscribe"
  track "Subscribe active pack" "POST" "/subscriptions/subscribe"
  RES=$(do_req -X POST "$BASE/subscriptions/subscribe" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"packId\":\"$ACTIVE_PACK_ID\",\"paymentProvider\":\"paystack\",\"providerReference\":\"ps_${TS}\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Subscribe to active pack"    201 "$STATUS" "$BODY"
  assert_field "  has id"                    "id"              "$BODY"
  assert_field "  has status"               "status"          "$BODY"
  assert_field "  has expiresAt"            "expiresAt"       "$BODY"
  assert_contains "  status is ACTIVE"      '"status":"ACTIVE"' "$BODY"
  SUB_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Subscription ID: $SUB_ID"

  # ── 9. Renewal ────────────────────────────────────────────
  step "9. POST /subscriptions/subscribe — renewal"
  endpoint "POST" "/subscriptions/subscribe"
  track "Renewal" "POST" "/subscriptions/subscribe"
  RES=$(do_req -X POST "$BASE/subscriptions/subscribe" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"packId\":\"$ACTIVE_PACK_ID\",\"paymentProvider\":\"paystack\",\"providerReference\":\"ps_renew_${TS}\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Renewal subscription created" 201 "$STATUS" "$BODY"
  RENEWED_SUB_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── 10. GET my subscriptions ──────────────────────────────
  step "10. GET /subscriptions/my"
  endpoint "GET" "/subscriptions/my"
  track "GET my subs" "GET" "/subscriptions/my"
  RES=$(do_req -X GET "$BASE/subscriptions/my" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET my subscriptions"         200 "$STATUS" "$BODY"
  assert_contains "  old sub CANCELLED"         '"status":"CANCELLED"' "$BODY"
  assert_contains "  new sub ACTIVE"            '"status":"ACTIVE"'    "$BODY"

  # ── 11. Check access ──────────────────────────────────────
  step "11. GET /subscriptions/my/access/:examId"
  endpoint "GET" "/subscriptions/my/access/:examId"
  track "Check access" "GET" "/subscriptions/my/access/:examId"
  RES=$(do_req -X GET "$BASE/subscriptions/my/access/$EXAM_ID" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Check access (has sub)"          200 "$STATUS" "$BODY"
  assert_contains "  returns ACTIVE subscription"  '"status":"ACTIVE"' "$BODY"

  # ── 12. Cancel subscription ───────────────────────────────
  step "12. DELETE /subscriptions/my/:id/cancel"
  endpoint "DELETE" "/subscriptions/my/:id/cancel"
  track "Cancel sub" "DELETE" "/subscriptions/my/:id/cancel"
  RES=$(do_req -X DELETE "$BASE/subscriptions/my/$RENEWED_SUB_ID/cancel" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Cancel subscription"         200 "$STATUS" "$BODY"
  assert_contains "  status CANCELLED"         '"status":"CANCELLED"' "$BODY"

  # Already-cancelled → 400
  track "Cancel already-cancelled" "DELETE" "/subscriptions/my/:id/cancel"
  RES=$(do_req -X DELETE "$BASE/subscriptions/my/$RENEWED_SUB_ID/cancel" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Cancel already-cancelled 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 13. Admin: GET all subscriptions ─────────────────────
  step "13. GET /subscriptions/admin/all (admin)"
  endpoint "GET" "/subscriptions/admin/all"
  track "Admin GET all subs" "GET" "/subscriptions/admin/all"
  RES=$(do_req -X GET "$BASE/subscriptions/admin/all?page=1&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET all subscriptions (admin)" 200 "$STATUS" "$BODY"
  assert_field "  has total"                   "total" "$BODY"
  assert_field "  has items"                   "items" "$BODY"
  assert_field "  has page"                    "page"  "$BODY"

  # Learner → 403
  track "Learner GET admin subs" "GET" "/subscriptions/admin/all"
  RES=$(do_req -X GET "$BASE/subscriptions/admin/all" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Admin subs as learner 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 14. Admin grant ───────────────────────────────────────
  step "14. POST /subscriptions/admin/grant — admin override"
  endpoint "POST" "/subscriptions/admin/grant"
  track "Admin grant" "POST" "/subscriptions/admin/grant"
  RES=$(do_req -X POST "$BASE/subscriptions/admin/grant" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"userId\":\"$LEARNER2_ID\",\"packId\":\"$ACTIVE_PACK_ID\",\"durationDaysOverride\":7}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Admin grant access"          201 "$STATUS" "$BODY"
  assert_contains "  status ACTIVE"            '"status":"ACTIVE"' "$BODY"
  assert_contains "  ADMIN_OVERRIDE marker"    "ADMIN_OVERRIDE"   "$BODY"

  # ── 15. Expire stale subscriptions ───────────────────────
  step "15. POST /subscriptions/admin/expire-stale"
  endpoint "POST" "/subscriptions/admin/expire-stale"
  track "Expire stale subs" "POST" "/subscriptions/admin/expire-stale"
  RES=$(do_req -X POST "$BASE/subscriptions/admin/expire-stale" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Expire stale subscriptions"  201 "$STATUS" "$BODY"
  assert_contains "  has expired count"        '"expired"' "$BODY"

  section_end
}

# =============================================================================
#  § 4  QUESTIONS
# =============================================================================
run_questions() {
  begin_section "❓" "Question Registry"

  local EXAM_NAME="SYSQ_${TS}"
  local RES BODY STATUS EXAM_ID Q_ID

  local ADMIN_TOKEN
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  LEARNER_EMAIL_Q="sys_q_learner_${TS}@quezia.dev"
  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$LEARNER_EMAIL_Q\",\"username\":\"sys_q_l_${TS}\",\"password\":\"Test@1234\"}")
  local LEARNER_TOKEN
  LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$EXAM_NAME\",\"description\":\"Q test\",\"isActive\":true}")
  EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── 1. Create question ─────────────────────────────────────
  step "1. POST /questions — create MCQ (admin)"
  endpoint "POST" "/questions"
  track "Create question" "POST" "/questions"
  RES=$(do_req -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_${TS}_001\",\"version\":1,\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"2+2=?\",\"options\":[{\"key\":\"A\",\"text\":\"3\"},{\"key\":\"B\",\"text\":\"4\"},{\"key\":\"C\",\"text\":\"5\"},{\"key\":\"D\",\"text\":\"6\"}]},\"correctAnswer\":\"B\",\"explanation\":\"Basic arithmetic\",\"marks\":4}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Create MCQ question"  201 "$STATUS" "$BODY"
  assert_field "  has id"             "id"         "$BODY"
  assert_field "  has questionId"     "questionId" "$BODY"
  Q_ID=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | cut -d'"' -f4)
  info "Question ID: $Q_ID"

  # ── 2. Create numeric question ─────────────────────────────
  step "2. POST /questions — create NUMERIC"
  endpoint "POST" "/questions"
  track "Create numeric question" "POST" "/questions"
  RES=$(do_req -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_${TS}_002\",\"version\":1,\"subject\":\"Physics\",\"topic\":\"Mechanics\",\"subtopic\":\"Velocity\",\"difficulty\":\"MEDIUM\",\"questionType\":\"NUMERIC\",\"contentPayload\":{\"question\":\"v=d/t, d=100, t=10\"},\"correctAnswer\":\"10\",\"explanation\":\"v=10m/s\",\"marks\":4,\"numericTolerance\":0.5}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Create NUMERIC question" 201 "$STATUS" "$BODY"

  # ── 2b. Invalid MCQ — bad correctAnswer key → 400 ────────
  step "2b. POST /questions — invalid MCQ (bad answer key) → 400"
  endpoint "POST" "/questions"
  track "Invalid MCQ question" "POST" "/questions"
  RES=$(do_req -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_${TS}_BAD\",\"version\":1,\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"2+2=?\",\"options\":[{\"key\":\"A\",\"text\":\"3\"},{\"key\":\"B\",\"text\":\"4\"}]},\"correctAnswer\":\"Z\",\"explanation\":\"invalid\",\"marks\":4}")
  assert_http "Invalid MCQ answer key 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 3. Duplicate question ID → 409 ────────────────────────
  step "3. POST /questions — duplicate questionId → 409"
  endpoint "POST" "/questions"
  track "Duplicate question" "POST" "/questions"
  RES=$(do_req -X POST "$BASE/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_${TS}_001\",\"version\":1,\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"2+2=?\",\"options\":[{\"key\":\"A\",\"text\":\"3\"},{\"key\":\"B\",\"text\":\"4\"}]},\"correctAnswer\":\"B\",\"explanation\":\"duplicate\",\"marks\":4}")
  assert_http "Duplicate questionId 409" 409 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 4. Learner create question → 403 ──────────────────────
  step "4. POST /questions — learner → 403"
  endpoint "POST" "/questions"
  track "Learner create question" "POST" "/questions"
  RES=$(do_req -X POST "$BASE/questions" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"LEAK_${TS}\",\"subject\":\"Math\",\"topic\":\"X\",\"subtopic\":\"Y\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{},\"correctAnswer\":\"A\",\"marks\":4}")
  assert_http "Learner create question 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 5. GET question ────────────────────────────────────────
  step "5. GET /questions/:questionId"
  endpoint "GET" "/questions/:questionId"
  track "GET question" "GET" "/questions/:questionId"
  RES=$(do_req -X GET "$BASE/questions/$Q_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET question by id"   200 "$STATUS" "$BODY"
  assert_field "  has questionId"     "questionId" "$BODY"
  assert_field "  has difficulty"     "difficulty" "$BODY"

  # ── 6. Validate question content ──────────────────────────
  step "6. POST /questions/validate — validate content"
  endpoint "POST" "/questions/validate"
  track "Validate question" "POST" "/questions/validate"
  RES=$(do_req -X POST "$BASE/questions/validate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_VAL_${TS}\",\"questionType\":\"MCQ\",\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"contentPayload\":{\"question\":\"Test?\",\"options\":[{\"key\":\"A\",\"text\":\"Yes\"},{\"key\":\"B\",\"text\":\"No\"}]},\"correctAnswer\":\"A\",\"explanation\":\"test explanation\",\"marks\":4}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Validate valid question" 200 "$STATUS" "$BODY"
  assert_contains "  has valid:true" '"valid":true' "$BODY"

  # ── 6b. Validate invalid NUMERIC (no tolerance) → 400 ─────
  step "6b. POST /questions/validate — invalid NUMERIC (no tolerance) → 400"
  endpoint "POST" "/questions/validate"
  track "Validate invalid NUMERIC" "POST" "/questions/validate"
  RES=$(do_req -X POST "$BASE/questions/validate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"SYSQ_VAL_BAD_${TS}\",\"questionType\":\"NUMERIC\",\"subject\":\"Physics\",\"topic\":\"Mechanics\",\"subtopic\":\"Velocity\",\"difficulty\":\"EASY\",\"contentPayload\":{\"question\":\"What is v?\"},\"correctAnswer\":\"10\",\"explanation\":\"v=10\",\"marks\":4}")
  assert_http "Validate invalid NUMERIC 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  section_end
}

# =============================================================================
#  § 5  TESTS & ATTEMPTS (FULL FLOW)
# =============================================================================
run_tests_attempts() {
  begin_section "📝" "Tests & Attempts"

  local RES BODY STATUS
  local ADMIN_TOKEN LEARNER_TOKEN LEARNER_ID
  local EXAM_ID BLUEPRINT_ID THREAD_ID TEST_ID ATTEMPT_ID
  local Q1 Q2 Q3 Q4 Q5

  # Tokens & setup
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"sys_test_l_${TS}@quezia.dev\",\"username\":\"sys_test_l_${TS}\",\"password\":\"Test@1234\"}")
  LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  LEARNER_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"SYSTEST_${TS}\",\"description\":\"Test flow\",\"isActive\":true}")
  EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":1,\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[{\"subject\":\"Math\",\"sequence\":1,\"sectionDurationSeconds\":3600}],\"rules\":[{\"totalTimeSeconds\":3600,\"negativeMarking\":true,\"negativeMarkValue\":0.25,\"partialMarking\":false,\"adaptiveAllowed\":false,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\"}]}")
  BLUEPRINT_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── 1. Create thread ──────────────────────────────────────
  step "1. POST /test-threads — create SYSTEM thread"
  endpoint "POST" "/test-threads"
  track "Create thread" "POST" "/test-threads"
  RES=$(do_req -X POST "$BASE/test-threads" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"Sys Test ${TS}\",\"baseGenerationConfig\":{}}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Create SYSTEM thread"  201 "$STATUS" "$BODY"
  assert_field "  has id"              "id"        "$BODY"
  assert_field "  has examId"          "examId"    "$BODY"
  THREAD_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Thread ID: $THREAD_ID"

  # Inactive exam → 400
  step "1b. Create thread for inactive exam → 400"
  endpoint "POST" "/test-threads"
  local INACTIVE_EXAM_ID
  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"INACTIVE_${TS}\",\"isActive\":false}")
  INACTIVE_EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  track "Thread for inactive exam" "POST" "/test-threads"
  RES=$(do_req -X POST "$BASE/test-threads" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$INACTIVE_EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"X\",\"baseGenerationConfig\":{}}")
  assert_http "Thread for inactive exam 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 2. Generate test ──────────────────────────────────────
  step "2. POST /test-threads/:id/generate — with blueprint"
  endpoint "POST" "/test-threads/:id/generate"
  track "Generate test" "POST" "/test-threads/:id/generate"
  RES=$(do_req -X POST "$BASE/test-threads/$THREAD_ID/generate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Generate test"          201 "$STATUS" "$BODY"
  assert_field "  has id"               "id"             "$BODY"
  assert_field "  has totalQuestions"   "totalQuestions" "$BODY"
  assert_field "  has status DRAFT"     "status"         "$BODY"
  assert_contains "  status is DRAFT"  '"status":"DRAFT"' "$BODY"
  TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Test ID: $TEST_ID"

  # Thread already has version → regenerate
  track "Re-generate: second generate should fail" "POST" "/test-threads/:id/generate"
  RES=$(do_req -X POST "$BASE/test-threads/$THREAD_ID/generate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
  assert_http "Double generate rejected 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 3. GET test by ID ─────────────────────────────────────
  step "3. GET /tests/:id — test detail"
  endpoint "GET" "/tests/:id"
  track "GET test" "GET" "/tests/:id"
  RES=$(do_req -X GET "$BASE/tests/$TEST_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "GET test detail"          200 "$STATUS" "$BODY"
  assert_field "  has sectionSnapshot"    "sectionSnapshot" "$BODY"
  assert_field "  has ruleSnapshot"       "ruleSnapshot"    "$BODY"

  # ── 4. GET test questions ────────────────────────────────
  step "4. GET /tests/:id/questions — snapshotted questions"
  endpoint "GET" "/tests/:id/questions"
  track "GET test questions" "GET" "/tests/:id/questions"
  RES=$(do_req -X GET "$BASE/tests/$TEST_ID/questions" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET test questions"         200 "$STATUS" "$BODY"
  assert_contains "  returns array"           "\[" "$BODY"
  Q1=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | head -1 | cut -d'"' -f4)
  Q2=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | head -2 | tail -1 | cut -d'"' -f4)
  Q3=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | head -3 | tail -1 | cut -d'"' -f4)
  Q4=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | head -4 | tail -1 | cut -d'"' -f4)
  Q5=$(echo "$BODY" | grep -o '"questionId":"[^"]*"' | head -5 | tail -1 | cut -d'"' -f4)

  # Get correct answers
  local A1 A2 A3 A4 A5
  if command -v jq &>/dev/null; then
    A1=$(echo "$BODY" | jq -r ".[] | select(.questionId==\"$Q1\") | .correctAnswer")
    A3=$(echo "$BODY" | jq -r ".[] | select(.questionId==\"$Q3\") | .correctAnswer")
    A4=$(echo "$BODY" | jq -r ".[] | select(.questionId==\"$Q4\") | .correctAnswer")
  else
    local BCLEAN; BCLEAN=$(echo "$BODY" | tr -d '\n\r')
    A1=$(echo "$BCLEAN" | grep -o "\"questionId\":\"$Q1\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
    A3=$(echo "$BCLEAN" | grep -o "\"questionId\":\"$Q3\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
    A4=$(echo "$BCLEAN" | grep -o "\"questionId\":\"$Q4\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
  fi
  info "Sample questions: $Q1  $Q2  $Q3  …"

  # ── 5. Start attempt on DRAFT → 400 ──────────────────────
  step "5. POST /attempts/:testId/start — on DRAFT → 400"
  endpoint "POST" "/attempts/:testId/start"
  track "Attempt on DRAFT" "POST" "/attempts/:testId/start"
  RES=$(do_req -X POST "$BASE/attempts/$TEST_ID/start" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Attempt on DRAFT test 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 6. Publish test ───────────────────────────────────────
  step "6. PATCH /tests/:id/publish"
  endpoint "PATCH" "/tests/:id/publish"
  track "Publish test" "PATCH" "/tests/:id/publish"
  RES=$(do_req -X PATCH "$BASE/tests/$TEST_ID/publish" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Publish test"               200 "$STATUS" "$BODY"
  assert_contains "  status PUBLISHED"        '"status":"PUBLISHED"' "$BODY"

  # Publish learner → 403
  track "Learner publish" "PATCH" "/tests/:id/publish"
  local LEARNER_THREAD_ID LEARNER_TEST_ID
  RES=$(do_req -X POST "$BASE/test-threads" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"GENERATED\",\"title\":\"Learner Test\",\"baseGenerationConfig\":{}}")
  LEARNER_THREAD_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  RES=$(do_req -X POST "$BASE/test-threads/$LEARNER_THREAD_ID/generate" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
  LEARNER_TEST_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  RES=$(do_req -X PATCH "$BASE/tests/$LEARNER_TEST_ID/publish" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Learner publish 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 7. Start attempt ──────────────────────────────────────
  step "7. POST /attempts/:testId/start — learner starts attempt"
  endpoint "POST" "/attempts/:testId/start"
  track "Start attempt" "POST" "/attempts/:testId/start"
  RES=$(do_req -X POST "$BASE/attempts/$TEST_ID/start" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Start attempt"         201 "$STATUS" "$BODY"
  assert_field "  has id"              "id"     "$BODY"
  assert_contains "  status ACTIVE"   '"status":"ACTIVE"' "$BODY"
  ATTEMPT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Attempt ID: $ATTEMPT_ID"

  # Idempotent: second start returns existing active attempt
  track "Second start idempotent" "POST" "/attempts/:testId/start"
  RES=$(do_req -X POST "$BASE/attempts/$TEST_ID/start" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Second start returns existing attempt" 201 "$STATUS" "$BODY"
  assert_contains "  same attempt ID returned" "$ATTEMPT_ID" "$BODY"

  # ── 8. GET attempt questions ──────────────────────────────
  step "8. GET /attempts/:id/questions"
  endpoint "GET" "/attempts/:id/questions"
  track "GET attempt questions" "GET" "/attempts/:id/questions"
  RES=$(do_req -X GET "$BASE/attempts/$ATTEMPT_ID/questions" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "GET attempt questions"   200 "$STATUS" "$BODY"
  assert_contains "  returns array"        "\[" "$BODY"

  # ── 9. Submit answers ─────────────────────────────────────
  step "9. POST /attempts/:id/submit — submit answers"
  endpoint "POST" "/attempts/:id/submit"

  local WRONG_A1
  [[ "$A1" == "A" ]] && WRONG_A1="B" || WRONG_A1="A"

  track "Submit correct Q1" "POST" "/attempts/:id/submit"
  RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"questionId\":\"$Q1\",\"answer\":\"$A1\"}")
  assert_http "Submit correct answer (Q1)" 201 "$(parse_status "$RES")" "$(parse_body "$RES")"

  if [[ -n "$Q3" ]]; then
    local WRONG_A3
    [[ "$A3" == "A" ]] && WRONG_A3="B" || WRONG_A3="A"
    track "Submit wrong Q3" "POST" "/attempts/:id/submit"
    RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
      -H "Authorization: Bearer $LEARNER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"questionId\":\"$Q3\",\"answer\":\"$WRONG_A3\"}")
    assert_http "Submit wrong answer (Q3)" 201 "$(parse_status "$RES")" "$(parse_body "$RES")"
  fi

  if [[ -n "$Q4" ]]; then
    track "Submit correct Q4" "POST" "/attempts/:id/submit"
    RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
      -H "Authorization: Bearer $LEARNER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"questionId\":\"$Q4\",\"answer\":\"$A4\"}")
    assert_http "Submit correct answer (Q4)" 201 "$(parse_status "$RES")" "$(parse_body "$RES")"
  fi

  # ── 10. Complete attempt ──────────────────────────────────
  step "10. POST /attempts/:id/submit-test — complete & grade"
  endpoint "POST" "/attempts/:id/submit-test"
  track "Complete attempt" "POST" "/attempts/:id/submit-test"
  RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit-test" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Complete attempt (grading)" 200 "$STATUS" "$BODY"
  assert_field "  has totalScore"           "totalScore" "$BODY"
  assert_field "  has accuracy"             "accuracy"   "$BODY"
  assert_field "  has riskRatio"            "riskRatio"  "$BODY"
  assert_field "  has percentile"           "percentile" "$BODY"
  assert_field "  has userRank"             "userRank"   "$BODY"
  assert_contains "  status COMPLETED"     '"status":"COMPLETED"' "$BODY"
  info "Score: $(echo "$BODY" | grep -o '"totalScore":"[^"]*"' | head -1 | cut -d'"' -f4)  Accuracy: $(echo "$BODY" | grep -o '"accuracy":"[^"]*"' | head -1 | cut -d'"' -f4)%"

  # Complete again → 400
  track "Complete already-completed" "POST" "/attempts/:id/submit-test"
  RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit-test" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Complete already-done 400" 400 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 11. Archive test ──────────────────────────────────────
  step "11. PATCH /tests/:id/archive"
  endpoint "PATCH" "/tests/:id/archive"
  track "Archive test" "PATCH" "/tests/:id/archive"
  RES=$(do_req -X PATCH "$BASE/tests/$TEST_ID/archive" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Archive test"               200 "$STATUS" "$BODY"
  assert_contains "  status ARCHIVED"         '"status":"ARCHIVED"' "$BODY"

  section_end
}

# =============================================================================
#  § 6  ADMIN & ANALYTICS
# =============================================================================
run_admin_analytics() {
  begin_section "🛡️ " "Admin Operations"

  local RES BODY STATUS
  local ADMIN_TOKEN LEARNER_TOKEN LEARNER2_TOKEN L1_ID L2_ID
  local EXAM_ID BLUEPRINT_ID THREAD_ID SYSTEM_TEST_ID ATTEMPT_ID

  # Tokens & exam
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  local L1_EMAIL="sys_adm1_${TS}@quezia.dev" L2_EMAIL="sys_adm2_${TS}@quezia.dev"
  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$L1_EMAIL\",\"username\":\"sys_adm1_${TS}\",\"password\":\"Test@1234\"}")
  LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  L1_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$L2_EMAIL\",\"username\":\"sys_adm2_${TS}\",\"password\":\"Test@1234\"}")
  LEARNER2_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  L2_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"SYSADM_${TS}\",\"isActive\":true}")
  EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":1,\"defaultDurationSeconds\":3600,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[{\"subject\":\"Math\",\"sequence\":1,\"sectionDurationSeconds\":3600}],\"rules\":[{\"totalTimeSeconds\":3600,\"negativeMarking\":true,\"negativeMarkValue\":0.25,\"partialMarking\":false,\"adaptiveAllowed\":false,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\"}]}")
  BLUEPRINT_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # ── 1. System analytics ───────────────────────────────────
  step "1. GET /admin/analytics/system"
  endpoint "GET" "/admin/analytics/system"
  track "System analytics" "GET" "/admin/analytics/system"
  RES=$(do_req -X GET "$BASE/admin/analytics/system" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "System analytics"     200 "$STATUS" "$BODY"
  assert_field "  has users"          "users"    "$BODY"
  assert_field "  has exams"          "exams"    "$BODY"
  assert_field "  has tests"          "tests"    "$BODY"
  assert_field "  has attempts"       "attempts" "$BODY"

  # Learner → 403
  track "Learner system analytics" "GET" "/admin/analytics/system"
  RES=$(do_req -X GET "$BASE/admin/analytics/system" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  assert_http "Learner system analytics 403" 403 "$(parse_status "$RES")" "$(parse_body "$RES")"

  # ── 2. User listing & search ──────────────────────────────
  step "2. GET /admin/users — list / search / filter"
  endpoint "GET" "/admin/users"
  track "List users" "GET" "/admin/users"
  RES=$(do_req -X GET "$BASE/admin/users?page=1&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "List all users"        200 "$STATUS" "$BODY"
  assert_field "  has users array"     "users"      "$BODY"
  assert_field "  has pagination"      "pagination" "$BODY"
  assert_field "  has total"           "total"      "$BODY"

  track "Search users" "GET" "/admin/users?search=..."
  RES=$(do_req -X GET "$BASE/admin/users?search=sys_adm&page=1&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Search users"                200 "$STATUS" "$BODY"
  assert_contains "  finds test learners"      "$L1_EMAIL" "$BODY"

  # ── 3. User detail ─────────────────────────────────────────
  step "3. GET /admin/users/:userId"
  endpoint "GET" "/admin/users/:userId"
  track "User detail" "GET" "/admin/users/:userId"
  RES=$(do_req -X GET "$BASE/admin/users/$L1_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Get user detail"           200 "$STATUS" "$BODY"
  assert_field "  has email"               "email"         "$BODY"
  assert_field "  has subscriptions"       "subscriptions" "$BODY"
  assert_field "  has attempts"            "attempts"      "$BODY"

  # ── 4. Suspend & activate ────────────────────────────────
  step "4. POST /admin/users/:id/suspend & activate"
  endpoint "POST" "/admin/users/:id/suspend"
  track "Suspend user" "POST" "/admin/users/:id/suspend"
  RES=$(do_req -X POST "$BASE/admin/users/$L2_ID/suspend" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Suspend user"          200 "$STATUS" "$BODY"
  assert_contains "  has message"        "suspended" "$BODY"

  track "Suspended user login blocked" "POST" "/auth/login"
  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$L2_EMAIL\",\"password\":\"Test@1234\"}")
  assert_http "Suspended user cannot login 401" 401 "$(parse_status "$RES")" "$(parse_body "$RES")"

  track "Activate user" "POST" "/admin/users/:id/activate"
  RES=$(do_req -X POST "$BASE/admin/users/$L2_ID/activate" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Activate user"         200 "$STATUS" "$BODY"
  assert_contains "  has message"        "activated" "$BODY"

  # ── 5. Audit logs ─────────────────────────────────────────
  step "5. GET /admin/audit-logs"
  endpoint "GET" "/admin/audit-logs"
  track "Audit logs" "GET" "/admin/audit-logs"
  RES=$(do_req -X GET "$BASE/admin/audit-logs?page=1&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Get audit logs"       200 "$STATUS" "$BODY"
  assert_field "  has logs array"     "logs"       "$BODY"
  assert_field "  has pagination"     "pagination" "$BODY"

  # ── 6. Test statistics ────────────────────────────────────
  step "6. GET /admin/tests/statistics"
  endpoint "GET" "/admin/tests/statistics"
  track "Test statistics" "GET" "/admin/tests/statistics"
  RES=$(do_req -X GET "$BASE/admin/tests/statistics" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Test statistics"     200 "$STATUS" "$BODY"
  assert_field "  has summary"       "summary" "$BODY"
  assert_field "  has tests array"   "tests"   "$BODY"

  # ── 7. Peer benchmarking flow ─────────────────────────────
  step "7. Create SYSTEM test + complete for peer benchmark"
  endpoint "POST" "/test-threads"
  track "Create SYSTEM thread for benchmark" "POST" "/test-threads"
  RES=$(do_req -X POST "$BASE/test-threads" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"Benchmark ${TS}\",\"baseGenerationConfig\":{}}")
  THREAD_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  track "Generate SYSTEM test" "POST" "/test-threads/:id/generate"
  RES=$(do_req -X POST "$BASE/test-threads/$THREAD_ID/generate" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Generate SYSTEM test" 201 "$STATUS" "$BODY"
  SYSTEM_TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "System Test ID: $SYSTEM_TEST_ID"

  track "Publish SYSTEM test" "PATCH" "/tests/:id/publish"
  RES=$(do_req -X PATCH "$BASE/tests/$SYSTEM_TEST_ID/publish" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Publish SYSTEM test"            200 "$STATUS" "$BODY"
  assert_contains "  status PUBLISHED"            '"status":"PUBLISHED"' "$BODY"

  track "Start attempt" "POST" "/attempts/:testId/start"
  RES=$(do_req -X POST "$BASE/attempts/$SYSTEM_TEST_ID/start" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Start attempt" 201 "$STATUS" "$BODY"
  ATTEMPT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Get a question to answer
  RES=$(do_req -X GET "$BASE/attempts/$ATTEMPT_ID/questions" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  local AQ1
  AQ1=$(echo "$RES" | grep -o '"questionId":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -n "$AQ1" ]]; then
    do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
      -H "Authorization: Bearer $LEARNER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"questionId\":\"$AQ1\",\"answer\":\"A\"}" > /dev/null
  fi

  track "Complete attempt with peer benchmark" "POST" "/attempts/:id/submit-test"
  RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit-test" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Complete attempt (benchmark)" 200 "$STATUS" "$BODY"
  assert_field "  has percentile"             "percentile" "$BODY"
  assert_field "  has userRank"               "userRank"   "$BODY"

  # ── 8. Test performance stats ─────────────────────────────
  step "8. GET /admin/tests/:id/performance"
  endpoint "GET" "/admin/tests/:id/performance"
  track "Test performance stats" "GET" "/admin/tests/:id/performance"
  RES=$(do_req -X GET "$BASE/admin/tests/$SYSTEM_TEST_ID/performance" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Test performance stats"  200 "$STATUS" "$BODY"
  assert_field "  has test info"         "test"     "$BODY"
  assert_field "  has attempts count"    "attempts" "$BODY"
  assert_field "  has stats"             "stats"    "$BODY"

  # ── 9. Override visibility ────────────────────────────────
  step "9. PATCH /admin/tests/:id/visibility — force archive"
  endpoint "PATCH" "/admin/tests/:id/visibility"
  track "Override visibility" "PATCH" "/admin/tests/:id/visibility"
  RES=$(do_req -X PATCH "$BASE/admin/tests/$SYSTEM_TEST_ID/visibility" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"ARCHIVED"}')
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Override to ARCHIVED"       200 "$STATUS" "$BODY"
  assert_contains "  status ARCHIVED"         '"status":"ARCHIVED"' "$BODY"

  # ── 10. Exam analytics ────────────────────────────────────
  step "10. GET /admin/analytics/exam/:examId"
  endpoint "GET" "/admin/analytics/exam/:examId"
  track "Exam analytics" "GET" "/admin/analytics/exam/:examId"
  RES=$(do_req -X GET "$BASE/admin/analytics/exam/$EXAM_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Exam analytics"        200 "$STATUS" "$BODY"
  assert_field "  has exam info"       "exam"     "$BODY"
  assert_field "  has tests count"     "tests"    "$BODY"
  assert_field "  has attempts stats"  "attempts" "$BODY"

  section_end
}

# =============================================================================
#  § 7  GRADING & ANALYTICS
# =============================================================================
run_grading_analytics() {
  begin_section "📊" "Grading & Analytics"

  local RES BODY STATUS
  local ADMIN_TOKEN LEARNER_TOKEN LEARNER_ID EXAM_ID BLUEPRINT_ID
  local THREAD_ID TEST_ID ATTEMPT_ID Q_IDS QUESTIONS_BODY

  RES=$(do_req -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
  ADMIN_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"sys_grade_${TS}@quezia.dev\",\"username\":\"sys_grade_${TS}\",\"password\":\"Test@1234\"}")
  LEARNER_TOKEN=$(parse_body "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  LEARNER_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Setup: exam + blueprint with negative marking + bulk question seed
  RES=$(do_req -X POST "$BASE/exams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"SYSGRADE_${TS}\",\"isActive\":true}")
  EXAM_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  RES=$(do_req -X POST "$BASE/exams/$EXAM_ID/blueprints" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"version\":1,\"defaultDurationSeconds\":1800,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\",\"sections\":[{\"subject\":\"Math\",\"sequence\":1,\"sectionDurationSeconds\":1800}],\"rules\":[{\"totalTimeSeconds\":1800,\"negativeMarking\":true,\"negativeMarkValue\":0.25,\"partialMarking\":false,\"adaptiveAllowed\":false,\"effectiveFrom\":\"2025-01-01T00:00:00.000Z\"}]}")
  BLUEPRINT_ID=$(parse_body "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  # Seed 12 questions so the test has enough
  step "Setup — seed canonical questions"
  info "Seeding 12 Math questions for grading test…"
  for i in $(seq 1 12); do
    do_req -X POST "$BASE/questions" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"questionId\":\"SYSGRADE_${TS}_$(printf '%03d' $i)\",\"version\":1,\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"Q$i: 2+$i=?\",\"options\":[{\"key\":\"A\",\"text\":\"$(($i+1))\"},{\"key\":\"B\",\"text\":\"$(($i+2))\"},{\"key\":\"C\",\"text\":\"$(($i+3))\"},{\"key\":\"D\",\"text\":\"$(($i+4))\"}]},\"correctAnswer\":\"A\",\"explanation\":\"Answer is $(($i+1))\",\"marks\":4}" > /dev/null
  done

  # ── 1. Generate + publish test ────────────────────────────
  step "1. Generate & publish grading test"
  endpoint "POST" "/test-threads"
  track "Create grading thread" "POST" "/test-threads"
  RES=$(do_req -X POST "$BASE/test-threads" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"GENERATED\",\"title\":\"Grading Test ${TS}\",\"baseGenerationConfig\":{}}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Create grading thread" 201 "$STATUS" "$BODY"
  THREAD_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  track "Generate grading test" "POST" "/test-threads/:id/generate"
  RES=$(do_req -X POST "$BASE/test-threads/$THREAD_ID/generate" \
    -H "Authorization: Bearer $LEARNER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http "Generate grading test" 201 "$STATUS" "$BODY"
  TEST_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

  track "Publish grading test" "PATCH" "/tests/:id/publish"
  RES=$(do_req -X PATCH "$BASE/tests/$TEST_ID/publish" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Publish grading test"  200 "$STATUS" "$BODY"
  assert_contains "  status PUBLISHED"   '"status":"PUBLISHED"' "$BODY"

  # ── 2. Start attempt ──────────────────────────────────────
  step "2. Start attempt"
  endpoint "POST" "/attempts/:testId/start"
  track "Start grading attempt" "POST" "/attempts/:testId/start"
  RES=$(do_req -X POST "$BASE/attempts/$TEST_ID/start" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Start grading attempt"  201 "$STATUS" "$BODY"
  ATTEMPT_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  info "Attempt ID: $ATTEMPT_ID"

  # ── 3. Get questions & submit mixed answers ───────────────
  step "3. Submit mixed answers (correct/incorrect/skipped)"
  endpoint "GET" "/tests/:id/questions"
  RES=$(do_req -X GET "$BASE/tests/$TEST_ID/questions" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  QUESTIONS_BODY=$(parse_body "$RES")
  local -a QS=()
  while IFS= read -r qid; do QS+=("$qid"); done < <(echo "$QUESTIONS_BODY" | grep -o '"questionId":"[^"]*"' | cut -d'"' -f4)
  info "Test has ${#QS[@]} questions, submitting answers for first 6 + skipping last"

  local correct_count=0 wrong_count=0
  for idx in 0 1 2 3 4 5; do
    [[ $idx -ge ${#QS[@]} ]] && break
    local qid="${QS[$idx]}"
    local correct_ans
    if command -v jq &>/dev/null; then
      correct_ans=$(echo "$QUESTIONS_BODY" | jq -r ".[] | select(.questionId==\"$qid\") | .correctAnswer")
    else
      local bclean; bclean=$(echo "$QUESTIONS_BODY" | tr -d '\n\r')
      correct_ans=$(echo "$bclean" | grep -o "\"questionId\":\"$qid\"[^}]*\"correctAnswer\":\"[^\"]*\"" | grep -o '"correctAnswer":"[^"]*"' | cut -d'"' -f4)
    fi
    local submitted_ans="$correct_ans"
    # Make Q2 and Q4 wrong
    if [[ $idx -eq 2 || $idx -eq 4 ]]; then
      [[ "$correct_ans" == "A" ]] && submitted_ans="B" || submitted_ans="A"
      wrong_count=$((wrong_count+1))
    else
      correct_count=$((correct_count+1))
    fi
    track "Submit Q$((idx+1))" "POST" "/attempts/:id/submit"
    RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit" \
      -H "Authorization: Bearer $LEARNER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"questionId\":\"$qid\",\"answer\":\"$submitted_ans\"}")
    assert_http "Submit Q$((idx+1)) ($([ $idx -eq 2 ] || [ $idx -eq 4 ] && echo WRONG || echo CORRECT))" 201 "$(parse_status "$RES")" "$(parse_body "$RES")"
  done
  info "Submitted: $correct_count correct, $wrong_count wrong, rest skipped"

  # ── 4. Complete (grading engine) ─────────────────────────
  step "4. POST /attempts/:id/submit-test — trigger grading"
  endpoint "POST" "/attempts/:id/submit-test"
  track "Complete grading attempt" "POST" "/attempts/:id/submit-test"
  RES=$(do_req -X POST "$BASE/attempts/$ATTEMPT_ID/submit-test" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Complete attempt"        200 "$STATUS" "$BODY"
  assert_field "  has totalScore"        "totalScore" "$BODY"
  assert_field "  has accuracy"          "accuracy"   "$BODY"
  assert_field "  has riskRatio"         "riskRatio"  "$BODY"
  assert_field "  has percentile"        "percentile" "$BODY"
  assert_contains "  status COMPLETED"  '"status":"COMPLETED"' "$BODY"

  local score; score=$(echo "$BODY" | grep -o '"totalScore":"[^"]*"' | cut -d'"' -f4)
  local acc;   acc=$(echo "$BODY" | grep -o '"accuracy":"[^"]*"' | cut -d'"' -f4)
  local risk;  risk=$(echo "$BODY" | grep -o '"riskRatio":"[^"]*"' | cut -d'"' -f4)
  info "Result — Score: $score  Accuracy: $acc%  Risk: $risk"

  # ── 5. Verify analytics populated ────────────────────────
  step "5. GET /analytics/exam/:examId — verify computed analytics"
  endpoint "GET" "/analytics/exam/:examId"
  track "Get exam analytics" "GET" "/analytics/exam/:examId"
  RES=$(do_req -X GET "$BASE/analytics/exam/$EXAM_ID" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Exam analytics populated"    200 "$STATUS" "$BODY"
  assert_field "  has overallAccuracy"       "overallAccuracy"       "$BODY"
  assert_field "  has averageScore"          "averageScore"          "$BODY"
  assert_field "  has riskRatio"             "riskRatio"             "$BODY"
  assert_field "  has riskClassification"    "riskClassification"    "$BODY"
  assert_field "  has inefficiencyIndex"     "inefficiencyIndex"     "$BODY"
  assert_field "  has totalAttempts"         "totalAttempts"         "$BODY"
  assert_contains "  totalAttempts is 1"    '"totalAttempts":1' "$BODY"

  # ── 6. Subject analytics ──────────────────────────────────
  step "6. GET /analytics/exam/:examId/subjects"
  endpoint "GET" "/analytics/exam/:examId/subjects"
  track "Subject analytics" "GET" "/analytics/exam/:examId/subjects"
  RES=$(do_req -X GET "$BASE/analytics/exam/$EXAM_ID/subjects" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http     "Subject analytics"          200 "$STATUS" "$BODY"
  assert_field    "  has accuracy"             "accuracy" "$BODY"
  assert_field    "  has subject"              "subject"  "$BODY"
  assert_contains "  returns array"           "\["       "$BODY"

  # ── 7. Topic analytics ────────────────────────────────────
  step "7. GET /analytics/exam/:examId/topics"
  endpoint "GET" "/analytics/exam/:examId/topics"
  track "Topic analytics" "GET" "/analytics/exam/:examId/topics"
  RES=$(do_req -X GET "$BASE/analytics/exam/$EXAM_ID/topics" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Topic analytics"          200 "$STATUS" "$BODY"
  assert_field "  has healthStatus"       "healthStatus"     "$BODY"
  assert_field "  has easyAccuracy"       "easyAccuracy"     "$BODY"
  assert_field "  has consistencyScore"   "consistencyScore" "$BODY"
  assert_field "  has negativeRate"       "negativeRate"     "$BODY"

  # ── 8. Performance trend ──────────────────────────────────
  step "8. GET /analytics/exam/:examId/trend"
  endpoint "GET" "/analytics/exam/:examId/trend"
  track "Performance trend" "GET" "/analytics/exam/:examId/trend"
  RES=$(do_req -X GET "$BASE/analytics/exam/$EXAM_ID/trend" \
    -H "Authorization: Bearer $LEARNER_TOKEN")
  BODY=$(parse_body "$RES"); STATUS=$(parse_status "$RES")
  assert_http  "Performance trend"      200 "$STATUS" "$BODY"
  assert_field "  has attemptId"        "attemptId" "$BODY"
  assert_field "  has score"            "score"     "$BODY"
  assert_field "  has accuracy"         "accuracy"  "$BODY"

  section_end
}

# =============================================================================
#  GRAND SUMMARY
# =============================================================================
print_summary() {
  local grand_total=$(( TOTAL_PASS + TOTAL_FAIL ))
  local elapsed=$(( SECONDS - SUITE_START ))
  local pass_pct=0
  [[ $grand_total -gt 0 ]] && pass_pct=$(( TOTAL_PASS * 100 / grand_total ))

  blank
  printf "${C_BOLD}${C_WHITE}"
  printf "  ╔════════════════════════════════════════════════════════════╗\n"
  printf "  ║                   TEST SUITE RESULTS                      ║\n"
  printf "  ╚════════════════════════════════════════════════════════════╝\n"
  printf "${C_RESET}"
  blank

  # Per-section breakdown
  printf "  %-40s  %s  %s  %s\n" \
    "$(printf "${C_DIM}Module${C_RESET}")" \
    "$(printf "${C_GREEN}Passed${C_RESET}")" \
    "$(printf "${C_RED}Failed${C_RESET}")" \
    "$(printf "${C_DIM}Total${C_RESET}")"
  printf "  ${C_DIM}%-40s  %-8s  %-8s  %-6s${C_RESET}\n" \
    "────────────────────────────────────────" "──────" "──────" "──────"

  for i in "${!SECTION_NAMES[@]}"; do
    local sname="${SECTION_NAMES[$i]}"
    local sp="${SECTION_PASS[$i]}"
    local sf="${SECTION_FAIL[$i]}"
    local st=$(( sp + sf ))
    local icon="${C_GREEN}${SYM_PASS}${C_RESET}"
    [[ $sf -gt 0 ]] && icon="${C_RED}${SYM_FAIL}${C_RESET}"
    printf "  $icon %-38s  ${C_GREEN}%-8s${C_RESET}  ${C_RED}%-8s${C_RESET}  ${C_DIM}%-6s${C_RESET}\n" \
      "$sname" "$sp" "$sf" "$st"
  done

  printf "  ${C_DIM}%-40s  %-8s  %-8s  %-6s${C_RESET}\n" \
    "────────────────────────────────────────" "──────" "──────" "──────"

  local total_color="${C_GREEN}"
  [[ $TOTAL_FAIL -gt 0 ]] && total_color="${C_RED}"
  printf "  ${C_BOLD}%-40s  ${C_GREEN}%-8s${C_RESET}  ${C_RED}%-8s${C_RESET}  ${C_BOLD}%-6s${C_RESET}\n" \
    "TOTAL" "$TOTAL_PASS" "$TOTAL_FAIL" "$grand_total"
  blank
  printf "  ${C_DIM}Pass rate: ${total_color}${C_BOLD}%d%%${C_RESET}${C_DIM}   Duration: %ds${C_RESET}\n" \
    "$pass_pct" "$elapsed"
  blank

  # Failure analysis
  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    printf "  ${C_BG_RED}${C_WHITE}${C_BOLD}  FAILURE ANALYSIS  ${C_RESET}\n"
    blank
    local i=1
    for entry in "${FAILURES[@]}"; do
      IFS='|' read -r f_section f_label f_endpoint f_expected f_actual f_body <<< "$entry"
      printf "  ${C_RED}${C_BOLD}#%d${C_RESET}  ${C_BOLD}%s${C_RESET}\n" "$i" "$f_label"
      printf "     ${C_DIM}Module   :${C_RESET} %s\n"   "$f_section"
      printf "     ${C_DIM}Endpoint :${C_RESET} ${C_WHITE}%s${C_RESET}\n" "$f_endpoint"
      printf "     ${C_DIM}Expected :${C_RESET} ${C_GREEN}%s${C_RESET}\n" "$f_expected"
      printf "     ${C_DIM}Actual   :${C_RESET} ${C_RED}%s${C_RESET}\n"   "$f_actual"
      if [[ -n "$f_body" ]]; then
        printf "     ${C_DIM}Response :${C_RESET} ${C_DIM}%s${C_RESET}\n" "$f_body"
      fi
      blank
      i=$(( i+1 ))
    done
  fi

  # Final verdict
  if [[ $TOTAL_FAIL -eq 0 ]]; then
    printf "  ${C_BG_GREEN}${C_WHITE}${C_BOLD}  ✔  ALL ${grand_total} TESTS PASSED  ${C_RESET}\n"
  else
    printf "  ${C_BG_RED}${C_WHITE}${C_BOLD}  ✘  ${TOTAL_FAIL} TEST(S) FAILED  ${C_RESET}\n"
  fi
  blank
}

# =============================================================================
#  ENTRYPOINT
# =============================================================================
print_banner
check_server

run_auth_users
run_exams_blueprints
run_subscriptions
run_questions
run_tests_attempts
run_admin_analytics
run_grading_analytics

print_summary

[[ $TOTAL_FAIL -eq 0 ]]
