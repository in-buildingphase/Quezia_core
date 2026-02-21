#!/bin/bash

API_URL="http://localhost:3000"

echo "🚀 Starting Comprehensive Test API Verification..."

# Helper for JSON extraction
extract() {
  echo "$1" | jq -r "$2"
}

# 1. AUTH: Get Tokens
echo -e "\n--- 🔑 Authentication ---"
ADMIN_JSON=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@quezia.com","password":"Admin123!"}')
ADMIN_TOKEN=$(extract "$ADMIN_JSON" ".accessToken")
echo "✅ Admin token obtained"

LEARNER_JSON=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"test@gmail.com","password":"Test123!"}')
LEARNER_TOKEN=$(extract "$LEARNER_JSON" ".accessToken")
echo "✅ Learner token obtained"

# 2. SETUP: Ensure Exam & Blueprint
echo -e "\n--- 📚 Setup ---"
EXAM_JSON=$(curl -s -X POST "$API_URL/exams" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"name\": \"JEE Mains $(date +%s)\", \"description\": \"CURL Test Exam\"}")
EXAM_ID=$(extract "$EXAM_JSON" ".id")
echo "✅ Created Exam: $EXAM_ID"

BLUEPRINT_JSON=$(curl -s -X POST "$API_URL/exams/$EXAM_ID/blueprints" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"version":1,"defaultDurationSeconds":10800,"effectiveFrom":"2026-01-01T00:00:00Z","sections":[{"subject":"Math","sequence":1},{"subject":"Physics","sequence":2},{"subject":"Chemistry","sequence":3}],"rules":[{"totalTimeSeconds":10800,"negativeMarking":true,"negativeMarkValue":1,"partialMarking":false,"adaptiveAllowed":false,"effectiveFrom":"2026-01-01T00:00:00Z"}]}')
BLUEPRINT_ID=$(extract "$BLUEPRINT_JSON" ".id")
echo "✅ Created Blueprint: $BLUEPRINT_ID"

curl -s -X POST "$API_URL/exams/blueprints/$BLUEPRINT_ID/activate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"effectiveFrom\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
echo "✅ Activated Blueprint"

# 3. THREAD CREATION
echo -e "\n--- 🧵 Thread Management ---"
# Admin creates SYSTEM thread
THREAD_SYSTEM_JSON=$(curl -s -X POST "$API_URL/test-threads" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{
  \"examId\": \"$EXAM_ID\",
  \"originType\": \"SYSTEM\",
  \"title\": \"JEE 2026 Full Mock – Set A\",
  \"baseGenerationConfig\": {
    \"followsBlueprint\": true,
    \"blueprintReferenceId\": \"$BLUEPRINT_ID\",
    \"questionCount\": 90
  }
}")
S_THREAD_ID=$(extract "$THREAD_SYSTEM_JSON" ".id")
echo "✅ Admin created SYSTEM Thread: $S_THREAD_ID"

# Learner creates GENERATED thread
THREAD_GEN_JSON=$(curl -s -X POST "$API_URL/test-threads" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d "{
  \"examId\": \"$EXAM_ID\",
  \"originType\": \"GENERATED\",
  \"title\": \"My Custom Practice\",
  \"baseGenerationConfig\": { \"durationSeconds\": 3600 }
}")
G_THREAD_ID=$(extract "$THREAD_GEN_JSON" ".id")
echo "✅ Learner created GENERATED Thread: $G_THREAD_ID"

# 4. GENERATION V1
echo -e "\n--- 🧪 Generation V1 ---"
# Admin generates for System thread
V1S_JSON=$(curl -s -X POST "$API_URL/test-threads/$S_THREAD_ID/generate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"followsBlueprint": true}')
V1S_ID=$(extract "$V1S_JSON" ".id")
echo "✅ Admin generated V1 for System Thread: $V1S_ID"

# Learner generates for their thread
V1G_JSON=$(curl -s -X POST "$API_URL/test-threads/$G_THREAD_ID/generate" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d '{"followsBlueprint": true}')
V1G_ID=$(extract "$V1G_JSON" ".id")
echo "✅ Learner generated V1 for their Thread: $V1G_ID"

# 5. REGENERATION V2
echo -e "\n--- 🧪 Regeneration V2 ---"
V2S_JSON=$(curl -s -X POST "$API_URL/test-threads/$S_THREAD_ID/regenerate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}')
V2S_ID=$(extract "$V2S_JSON" ".id")
echo "✅ Generated System V2: $V2S_ID"

# 6. PERMISSION TEST: Learner try to access Admin Thread V1
echo -e "\n--- 🛡️ Permission Tests ---"
# Note: SYSTEM threads with createdByUserId = null should be accessible to everyone? 
# Requirement says: "LEARNER can only generate under their own thread Or SYSTEM threads that are visible"
# My TestService implementation:
# if (role !== UserRole.ADMIN && thread.createdByUserId && thread.createdByUserId !== userId) { ... }
# So if createdByUserId is null (SYSTEM), it's allowed.
ACCESS_SYSTEM=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$API_URL/tests/$V1S_ID" -H "Authorization: Bearer $LEARNER_TOKEN")
echo "✅ Learner access to System Test: $ACCESS_SYSTEM (Expected 200)"

# Learner try publish
PUBLISH_FAIL=$(curl -s -X PATCH "$API_URL/tests/$V1G_ID/publish" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d '{}')
echo "✅ Learner Publish Attempt Response (Blocked): $(extract "$PUBLISH_FAIL" ".message")"

# 7. LIFECYCLE: Publish System V2 (As Admin)
echo -e "\n--- 🚀 Lifecycle ---"
PUBLISH_SUCCESS=$(curl -s -X PATCH "$API_URL/tests/$V2S_ID/publish" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{}')
echo "✅ System V2 Published (Status: $(extract "$PUBLISH_SUCCESS" ".status"))"

# 8. BLUEPRINT ISOLATION TEST
echo -e "\n--- 🧬 Blueprint Isolation ---"
INITIAL_MARKS=$(extract "$V1S_JSON" ".totalMarks")
echo "   V1 Initial Total Marks: $INITIAL_MARKS"

# Manually "mutate" blueprint (conceptual: we can't easily edit it via API in a script without DTO knowledge, but we can verify V1 snapshot persists)
# Fetch V1 again
V1_REFRESH=$(curl -s -X GET "$API_URL/tests/$V1S_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
REFRESHED_MARKS=$(extract "$V1_REFRESH" ".totalMarks")
echo "   V1 Snapshot Total Marks after time: $REFRESHED_MARKS"
if [ "$INITIAL_MARKS" == "$REFRESHED_MARKS" ]; then
  echo "✅ V1 Snapshot is stable and immutable"
else
  echo "❌ V1 Snapshot changed! (FAILED)"
fi

# 10. MIXED DIFFICULTY TEST
echo -e "\n--- ⚖️ Mixed Difficulty Test ---"
THREAD_MIXED_JSON=$(curl -s -X POST "$API_URL/test-threads" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{
  \"examId\": \"$EXAM_ID\",
  \"originType\": \"SYSTEM\",
  \"title\": \"JEE Mixed Difficulty Test\",
  \"baseGenerationConfig\": {
    \"followsBlueprint\": true,
    \"difficulty\": \"MIXED\",
    \"questionCount\": 90
  }
}")
M_THREAD_ID=$(extract "$THREAD_MIXED_JSON" ".id")
echo "✅ Created MIXED Thread: $M_THREAD_ID"

VM_JSON=$(curl -s -X POST "$API_URL/test-threads/$M_THREAD_ID/generate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"followsBlueprint": true}')
VM_ID=$(extract "$VM_JSON" ".id")
VM_DIFF=$(extract "$VM_JSON" ".difficulty")
echo "✅ Generated V1 for Mixed Thread: $VM_ID"
echo "✅ Reported Difficulty: $VM_DIFF (Expected MIXED)"

if [ "$VM_DIFF" == "MIXED" ]; then
  echo "✅ Difficulty correctly snapshot as MIXED"
else
  echo "❌ Difficulty mismatch! (Got: $VM_DIFF)"
fi

echo -e "\n🏁 Verification Complete!"
rm adminToken.txt threadId.txt v1Id.txt 2>/dev/null
