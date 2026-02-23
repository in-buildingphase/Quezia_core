#!/bin/bash

BASE="http://localhost:3000"
TS=$(date +%s)

# Login as admin
echo "=== Logging in as admin ==="
RES=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@quezia.com","password":"Admin123!"}')
ADMIN_TOKEN=$(echo "$RES" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "Admin token: ${ADMIN_TOKEN:0:20}..."

# Create exam
echo -e "\n=== Creating exam ==="
RES=$(curl -s -X POST "$BASE/exams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Test Exam $TS\",\"subject\":\"Physics\",\"isActive\":true}")
EXAM_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Exam ID: $EXAM_ID"
echo "Response: $RES"

# Create blueprint
echo -e "\n=== Creating blueprint ==="
RES=$(curl -s -X POST "$BASE/exams/$EXAM_ID/blueprints" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds":3600,"totalQuestions":1,"totalMarks":"4","sections":[{"sectionId":"SEC1","subject":"Physics","questionCount":1,"marks":"4"}]}')
BLUEPRINT_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Blueprint ID: $BLUEPRINT_ID"
echo "Response: $RES"

# Create thread
echo -e "\n=== Creating thread ==="
RES=$(curl -s -X POST "$BASE/test-threads" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"examId\":\"$EXAM_ID\",\"originType\":\"SYSTEM\",\"title\":\"Publish Test $TS\",\"baseGenerationConfig\":{}}")
THREAD_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Thread ID: $THREAD_ID"
echo "Response: $RES"

# Generate test
echo -e "\n=== Generating test ==="
RES=$(curl -s -X POST "$BASE/test-threads/$THREAD_ID/generate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"followsBlueprint\":true,\"blueprintReferenceId\":\"$BLUEPRINT_ID\"}")
TEST_ID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
SECTION_ID=$(echo "$RES" | grep -o '"sectionId":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Test ID: $TEST_ID"
echo "Section ID: $SECTION_ID"
echo "Response: $RES"

# Get test before injection
echo -e "\n=== Test status BEFORE injection ==="
RES=$(curl -s -X GET "$BASE/tests/$TEST_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$RES" | grep -o '"status":"[^"]*"'
echo "Full test: $RES"

# Inject question
echo -e "\n=== Injecting question ==="
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/tests/$TEST_ID/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sectionId\":\"$SECTION_ID\",\"questions\":[{\"questionId\":\"PUB_Q1_${TS}\",\"questionType\":\"MCQ\",\"subject\":\"Physics\",\"topic\":\"T\",\"subtopic\":\"S\",\"difficulty\":\"EASY\",\"contentPayload\":{\"question\":\"Test Q\",\"options\":[{\"key\":\"A\",\"text\":\"Correct\"},{\"key\":\"B\",\"text\":\"Wrong\"}]},\"correctAnswer\":\"A\",\"explanation\":\"A is correct\",\"marks\":4}]}")
STATUS=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | sed '$d')
echo "HTTP Status: $STATUS"
echo "Response Body: $BODY"

# Get test after injection
echo -e "\n=== Test status AFTER injection ==="
RES=$(curl -s -X GET "$BASE/tests/$TEST_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$RES" | grep -o '"status":"[^"]*"'
TOTAL_QUESTIONS=$(echo "$RES" | grep -o '"totalQuestions":[0-9]*' | head -1)
echo "Total questions: $TOTAL_QUESTIONS"

# List questions
echo -e "\n=== Listing test questions ==="
RES=$(curl -s -X GET "$BASE/tests/$TEST_ID/questions" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
QUESTION_COUNT=$(echo "$RES" | grep -o '"questionId"' | wc -l)
echo "Question count in test: $QUESTION_COUNT"

# Publish test
echo -e "\n=== Publishing test ==="
RES=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE/tests/$TEST_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | sed '$d')
echo "HTTP Status: $STATUS"
echo "Response Body: $BODY"

# Verify published status
echo -e "\n=== Test status AFTER publish ==="
RES=$(curl -s -X GET "$BASE/tests/$TEST_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$RES" | grep -o '"status":"[^"]*"'
echo "Full test: $RES"

# Try to start attempt
echo -e "\n=== Starting attempt ==="
RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE/attempts/$TEST_ID/start" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$RES" | tail -n 1)
BODY=$(echo "$RES" | sed '$d')
echo "HTTP Status: $STATUS"
echo "Response Body: $BODY"
