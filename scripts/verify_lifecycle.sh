#!/bin/bash

API_URL="http://localhost:3000"

echo "🚀 Starting Full Lifecycle Simulation (Generation -> Attempt -> Complete)..."

extract() {
  echo "$1" | jq -r "$2"
}

# 1. AUTH
echo -e "\n--- 🔑 Authentication ---"
ADMIN_JSON=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@quezia.com","password":"Admin123!"}')
ADMIN_TOKEN=$(extract "$ADMIN_JSON" ".accessToken")
LEARNER_JSON=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d '{"email":"test@gmail.com","password":"Test123!"}')
LEARNER_TOKEN=$(extract "$LEARNER_JSON" ".accessToken")
echo "✅ Tokens obtained"

# 2. SETUP EXAM & BLUEPRINT
echo -e "\n--- 📚 Setup ---"
EXAM_JSON=$(curl -s -X POST "$API_URL/exams" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"name\": \"Lifecycle Test $(date +%s)\"}")
EXAM_ID=$(extract "$EXAM_JSON" ".id")
BLUEPRINT_JSON=$(curl -s -X POST "$API_URL/exams/$EXAM_ID/blueprints" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"version":1,"defaultDurationSeconds":3600,"effectiveFrom":"2026-01-01T00:00:00Z","sections":[{"subject":"Physics","sequence":1}],"rules":[{"totalTimeSeconds":3600,"negativeMarking":true,"negativeMarkValue":1,"partialMarking":false,"adaptiveAllowed":false,"effectiveFrom":"2026-01-01T00:00:00Z"}]}')
BLUE_ID=$(extract "$BLUEPRINT_JSON" ".id")
curl -s -X POST "$API_URL/exams/blueprints/$BLUE_ID/activate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"effectiveFrom\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null
echo "✅ Exam and Blueprint ready"

# 3. GENERATE TEST
echo -e "\n--- 🧵 Generation ---"
THREAD_JSON=$(curl -s -X POST "$API_URL/test-threads" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"Lifecycle Test\",\"baseGenerationConfig\":{}}")
THREAD_ID=$(extract "$THREAD_JSON" ".id")
V1_JSON=$(curl -s -X POST "$API_URL/test-threads/$THREAD_ID/generate" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"followsBlueprint":true}')
TEST_ID=$(extract "$V1_JSON" ".id")
echo "✅ Test Generated (Draft): $TEST_ID"

# PUBLISH TEST (Required to start attempt)
curl -s -X PATCH "$API_URL/tests/$TEST_ID/publish" -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
echo "✅ Test Published"

# 4. START ATTEMPT
echo -e "\n--- 📝 Attempt ---"
ATTEMPT_JSON=$(curl -s -X POST "$API_URL/attempts/$TEST_ID/start" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d '{}')
echo "DEBUG ATTEMPT_JSON: $ATTEMPT_JSON"
ATTEMPT_ID=$(extract "$ATTEMPT_JSON" ".id")
echo "✅ Attempt Started: $ATTEMPT_ID"

# 5. SUBMIT ANSWERS
# Get questions from the test to find logical questionId
TEST_DETAIL=$(curl -s -X GET "$API_URL/tests/$TEST_ID" -H "Authorization: Bearer $LEARNER_TOKEN")
echo "DEBUG TEST_DETAIL: $TEST_DETAIL"
Q1_LOGICAL_ID=$(echo "$TEST_DETAIL" | jq -r ".questions[0].questionId")
Q1_CONTENT=$(echo "$TEST_DETAIL" | jq -r ".questions[0].contentSnapshot")
CORRECT_ANSWER=$(echo "$TEST_DETAIL" | jq -r ".questions[0].correctAnswer")

echo "🧪 Question 1 Snapshot Content: $(echo $Q1_CONTENT | cut -c 1-50)..."
echo "🧪 Submitting Correct Answer: $CORRECT_ANSWER"

SUBMIT_RES=$(curl -s -X POST "$API_URL/attempts/$ATTEMPT_ID/submit" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d "{\"questionId\":\"$Q1_LOGICAL_ID\",\"answer\":\"$CORRECT_ANSWER\"}")
echo "✅ Answer submitted"

# 6. COMPLETE & GRADE
echo -e "\n--- 🏁 Completion ---"
COMPLETE_JSON=$(curl -s -X PATCH "$API_URL/attempts/$ATTEMPT_ID/complete" -H "Authorization: Bearer $LEARNER_TOKEN" -H "Content-Type: application/json" -d '{}')
STATUS=$(extract "$COMPLETE_JSON" ".status")
SCORE=$(extract "$COMPLETE_JSON" ".totalScore")
ACC=$(extract "$COMPLETE_JSON" ".accuracy")

echo "🏁 Attempt Status: $STATUS"
echo "🏁 Final Score: $SCORE"
echo "🏁 Accuracy: $ACC%"

if [ "$STATUS" == "COMPLETED" ] && [ "$SCORE" != "null" ]; then
  echo -e "\n✅ FULL LIFECYCLE SIMULATION SUCCESSFUL!"
else
  echo -e "\n❌ SIMULATION FAILED!"
  exit 1
fi

echo -e "\n🏁 Verification Complete!"
