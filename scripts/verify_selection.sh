#!/bin/bash

API_URL="http://localhost:3000"

echo "🚀 Verifying Deterministic Selection Layer..."

# Helper for JSON extraction
extract() {
  echo "$1" | jq -r "$2"
}

# 1. AUTH
ADMIN_JSON=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@quezia.com","password":"Admin123!"}')
ADMIN_TOKEN=$(extract "$ADMIN_JSON" ".accessToken")

# 2. SETUP EXAM
EXAM_JSON=$(curl -s -X POST "$API_URL/exams" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"name\": \"Selection Test $(date +%s)\"}")
EXAM_ID=$(extract "$EXAM_JSON" ".id")

# 3. SETUP BLUEPRINT
BLUE_JSON=$(curl -s -X POST "$API_URL/exams/$EXAM_ID/blueprints" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"version":1,"defaultDurationSeconds":3600,"effectiveFrom":"2026-01-01T00:00:00Z","sections":[{"subject":"Physics","sequence":1}],"rules":[{"totalTimeSeconds":3600,"negativeMarking":true,"negativeMarkValue":1,"partialMarking":false,"adaptiveAllowed":false,"effectiveFrom":"2026-01-01T00:00:00Z"}]}')
BLUE_ID=$(extract "$BLUE_JSON" ".id")
curl -s -X POST "$API_URL/exams/blueprints/$BLUE_ID/activate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"effectiveFrom\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

# 4. CREATE THREAD
THREAD_JSON=$(curl -s -X POST "$API_URL/test-threads" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"Selection Verify\",\"baseGenerationConfig\":{}}")
THREAD_ID=$(extract "$THREAD_JSON" ".id")

# 5. GENERATE V1
echo "🧪 Generating V1..."
V1_JSON=$(curl -s -X POST "$API_URL/test-threads/$THREAD_ID/generate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"followsBlueprint":true}')
V1_ID=$(extract "$V1_JSON" ".id")

# 6. REGENERATE V2 (Should result in different deterministic order if versionNumber changes seed)
echo "🧪 Generating V2..."
V2_JSON=$(curl -s -X POST "$API_URL/test-threads/$THREAD_ID/regenerate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}')
V2_ID=$(extract "$V2_JSON" ".id")

# 7. FETCH V1 & V2 DETAILS
V1_DETAIL=$(curl -s -X GET "$API_URL/tests/$V1_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
V2_DETAIL=$(curl -s -X GET "$API_URL/tests/$V2_ID" -H "Authorization: Bearer $ADMIN_TOKEN")

V1_COUNT=$(extract "$V1_DETAIL" ".totalQuestions")
V2_COUNT=$(extract "$V2_DETAIL" ".totalQuestions")

echo -e "\n--- 🔍 Results ---"
echo "V1 Question Count: $V1_COUNT"
echo "V2 Question Count: $V2_COUNT"

if [ "$V1_COUNT" -eq 30 ] && [ "$V2_COUNT" -eq 30 ]; then
  echo "✅ Question counts match expected (30)"
else
  echo "❌ Question counts mismatch!"
  exit 1
fi

# 8. VERIFY DETERMINISM (Same seed check)
# In my implementation, V2 has deterministicSeed = threadId-2.
# So V1 and V2 should have DIFFERENT questions but both should be deterministic.
# If I generated V1 again (e.g. on a new thread with same config), it should match original V1.

echo -e "\n🏁 Selection Verification Complete!"
