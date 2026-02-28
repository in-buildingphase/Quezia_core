# 📘 JEE AI Service — API Docs

**Base URL:** `http://localhost:8000`  
**Swagger UI:** `http://localhost:8000/docs`

---

## How It Works

```
Your Backend ──→ POST /ai/generate ──→ AI generates questions ──→ Student takes test
                                                                         │
Your Backend ──→ POST /ai/analyze  ←── AI analyzes results ←────────────┘
```

Only **2 main endpoints**. One call each — the AI handles everything internally.

---

## 1. `GET /health` — Health Check

```bash
curl http://localhost:8000/health
```

```json
{ "status": "healthy", "service": "jee-ai-service", "version": "2.0.0" }
```

---

## 2. `POST /ai/generate` — Generate Test

Two ways to use it:

### Option A — Natural Language (let AI decide everything)

```bash
curl -X POST http://localhost:8000/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "prompt": "give me a hard physics test on thermodynamics"
  }'
```

### Option B — Structured (you control the params)

```bash
curl -X POST http://localhost:8000/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "subjects": ["physics", "math", "chemistry"],
    "difficulty": "mixed",
    "questionCount": 90
  }'
```

### All Fields

| Field           | Type       | Required | Default     | Notes                                     |
|----------------|------------|----------|-------------|--------------------------------------------|
| `user_id`       | string     | ✅       | —           | Your user's ID                             |
| `prompt`        | string     | ❌       | —           | Natural language → AI auto-parses          |
| `subject`       | string     | ❌       | —           | `physics` / `math` / `chemistry`           |
| `subjects`      | string[]   | ❌       | —           | For multi-subject tests                    |
| `topic`         | string     | ❌       | —           | e.g. `"Thermodynamics"`                    |
| `difficulty`    | string     | ❌       | `"mixed"`   | `easy` / `medium` / `hard` / `mixed`       |
| `questionCount` | int        | ❌       | `30`        | 2–200 (use 90 for full JEE mock)           |

> Must provide at least one of: `prompt`, `subject`, or `subjects`

### Response

```json
{
  "user_id": "user123",
  "test_questions": [
    {
      "questionId": "PHY-THERMO-000342",
      "subject": "Physics",
      "topic": "Thermodynamics",
      "difficulty": "medium",
      "questionType": "MCQ",
      "contentPayload": {
        "question": "A gas expands at constant pressure...",
        "options": [
          { "key": "A", "text": "2e5 J" },
          { "key": "B", "text": "6e5 J" },
          { "key": "C", "text": "600 J" },
          { "key": "D", "text": "300 J" }
        ]
      },
      "correctAnswer": "D",
      "explanation": "Work = PΔV = 300 J",
      "marks": 4,
      "negativeMark": -1,
      "timeLimit": 120
    }
  ],
  "test_metadata": {
    "test_name": "JEE Main Mock Test",
    "total_questions": 90,
    "duration_minutes": 180,
    "marking_scheme": { "correct": 4, "incorrect": -1, "unanswered": 0 },
    "subject_distribution": { "physics": 30, "math": 30, "chemistry": 30 }
  }
}
```

---

## 3. `POST /ai/analyze` — Analyze Performance

Send student's answers after test → get insights + study plan.

```bash
curl -X POST http://localhost:8000/ai/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user123",
    "raw_attempt_data": {
      "attempts": [
        {
          "question_id": "PHY-THERMO-000342",
          "subject": "physics",
          "topic": "Thermodynamics",
          "difficulty": "medium",
          "is_correct": true,
          "time_taken_seconds": 95,
          "question_type": "mcq"
        },
        {
          "question_id": "MAT-CALC-001247",
          "subject": "math",
          "topic": "Calculus",
          "difficulty": "hard",
          "is_correct": false,
          "time_taken_seconds": 210,
          "question_type": "mcq"
        }
      ]
    }
  }'
```

### Each attempt object

| Field                | Type    | Description                |
|----------------------|---------|----------------------------|
| `question_id`        | string  | ID from the generated test |
| `subject`            | string  | physics / math / chemistry |
| `topic`              | string  | Topic name                 |
| `difficulty`         | string  | easy / medium / hard       |
| `is_correct`         | boolean | Did they get it right?     |
| `time_taken_seconds` | int     | Seconds spent              |
| `question_type`      | string  | mcq / numerical            |

### Response

```json
{
  "user_id": "user123",
  "performance_metrics": {
    "overall_accuracy": 0.72,
    "accuracy_by_subject": { "physics": 0.85, "math": 0.60 },
    "accuracy_by_topic": { "Thermodynamics": 0.90, "Calculus": 0.50 }
  },
  "insights": {
    "overall_assessment": "Strong in Physics, needs work in Math...",
    "weak_topics": ["Calculus", "Organic Chemistry"],
    "strong_topics": ["Thermodynamics", "Kinematics"],
    "recommendations": ["Practice integration problems daily"]
  },
  "study_plan": {
    "weekly_plan": { "week_1": "Focus on Calculus basics..." },
    "focus_areas": ["Integration", "Organic reactions"]
  }
}
```

---

## Errors

All errors return:

```json
{ "detail": "what went wrong" }
```

| Code  | Meaning                        |
|-------|--------------------------------|
| `400` | Bad request (missing/invalid)  |
| `500` | Server error                   |