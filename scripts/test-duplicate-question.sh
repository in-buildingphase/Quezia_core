#!/usr/bin/env bash
# Quick test: duplicate questionId should return 409 (not 500)
set -euo pipefail

BASE="http://localhost:3000"
ADMIN_EMAIL="admin@quezia.com"
ADMIN_PASS="Admin123!"
TS=$(date +%s)
QID="DUP_TEST_${TS}"

green()  { echo -e "\033[32m✔  $*\033[0m"; }
red()    { echo -e "\033[31m✘  $*\033[0m"; }
info()   { echo -e "\033[2m   $*\033[0m"; }

# Login
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
[[ -z "$TOKEN" ]] && { echo "ERROR: admin login failed"; exit 1; }
info "Admin token obtained"

PAYLOAD="{\"questionId\":\"$QID\",\"version\":1,\"subject\":\"Math\",\"topic\":\"Algebra\",\"subtopic\":\"Linear\",\"difficulty\":\"EASY\",\"questionType\":\"MCQ\",\"contentPayload\":{\"question\":\"2+2=?\",\"options\":[{\"key\":\"A\",\"text\":\"3\"},{\"key\":\"B\",\"text\":\"4\"}]},\"correctAnswer\":\"B\",\"explanation\":\"test\",\"marks\":4}"

# First create — expect 201
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/questions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
if [[ "$STATUS" == "201" ]]; then
  green "First create → 201 ✓"
else
  red "First create → $STATUS (expected 201)"; exit 1
fi

# Duplicate — expect 409
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/questions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")
if [[ "$STATUS" == "409" ]]; then
  green "Duplicate create → 409 ✓"
else
  BODY=$(curl -s -X POST "$BASE/questions" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  red "Duplicate create → $STATUS (expected 409)"
  info "Response: $BODY"
  exit 1
fi

echo ""
green "All checks passed!"
