# Quezia Core — Complete Backend API Reference

> **Base URL:** `http://localhost:3000`  
> **Generated:** 24 February 2026  
> **Source:** Full scan of all controllers, services, DTOs, guards, and `test-system.sh`

---

## Authentication Architecture

All endpoints are protected by `JwtAuthGuard` globally. Routes decorated with `@Public()` are exempt. The JWT payload contains `{ sub: userId, email, role }`. The **access token** is short-lived; the **refresh token** is stored hashed in the `Session` table — rotation is enforced (old session deleted on each use).

**Brute-force protection:** 5 failed logins → 15-minute lockout → `429 Too Many Requests`.

**Role system:** `ADMIN` · `LEARNER`

---

## Table of Contents

1. [Auth](#1-auth-auth)
2. [Users](#2-users-users)
3. [Exams & Blueprints](#3-exams--blueprints-exams)
4. [Subscriptions](#4-subscriptions-subscriptions)
5. [Questions](#5-questions-questions)
6. [Test Threads & Generation](#6-test-threads--generation-test-threads)
7. [Tests](#7-tests-tests)
8. [Attempts](#8-attempts-attempts)
9. [Analytics](#9-analytics-analytics)
10. [Admin](#10-admin-admin)
11. [Grading Engine](#grading-engine)
12. [Data Model Relationships](#data-model-relationships)
13. [Key Business Rules](#key-business-rules)

---

## 1. Auth (`/auth`)

All endpoints are `POST`. No auth required unless noted.

---

### `POST /auth/register`

**Auth:** None (`@Public`)

**Request body:**
```json
{
  "username": "string (3–50 chars)",
  "email":    "valid email",
  "password": "string (8–100, must contain uppercase + lowercase + digit)"
}
```

**Response `201`:**
```json
{
  "accessToken":  "jwt",
  "refreshToken": "jwt",
  "user": { "id": "cuid", "email": "string", "role": "LEARNER" }
}
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `409` | Email or username already exists |
| `400` | Validation failure |

---

### `POST /auth/login`

**Auth:** None (`@Public`)

**Request body:**
```json
{ "email": "valid email", "password": "string" }
```

**Response `200`:** Same shape as `/auth/register` response.

**Errors:**
| Status | Condition |
|--------|-----------|
| `401` | Invalid credentials or suspended account |
| `429` | Account locked — returns `{ "message": "...", "retryAfterSeconds": 900 }` |

---

### `POST /auth/refresh`

**Auth:** None (`@Public`)

**Request body:**
```json
{ "refreshToken": "jwt" }
```

**Response `200`:** Same shape as login. **Old session is deleted, new session created (rotation).**

**Errors:**
| Status | Condition |
|--------|-----------|
| `401` | Invalid, expired, or already-rotated refresh token |

---

### `POST /auth/logout`

**Auth:** Bearer JWT

**Request body:**
```json
{ "refreshToken": "string" }
```

**Response `200`:**
```json
{ "message": "Logged out successfully" }
```

**Effect:** Deletes the matching `Session` row for `(userId, refreshTokenHash)`. Subsequent use of the same refresh token returns `401`.

---

### `POST /auth/forgot-password`

**Auth:** None (`@Public`)

**Request body:**
```json
{ "email": "valid email" }
```

**Response `200`:** Always returns the same message regardless of whether email exists (anti-enumeration):
```json
{ "message": "If that email address is in our database, we will send you an email to reset your password." }
```

---

### `POST /auth/reset-password`

**Auth:** None (`@Public`)

**Request body:**
```json
{ "token": "string", "newPassword": "string (min 8 chars)" }
```

**Response `200`:** `{ "message": "..." }` on success  
**Errors:** `400` — invalid/unknown/expired token

---

### `POST /auth/verify-email`

**Auth:** None (`@Public`)

**Request body:**
```json
{ "token": "string" }
```

**Response `200`:**
```json
{ "message": "Email successfully verified" }
```

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Invalid or unknown token |

---

### `POST /auth/resend-verification`

**Auth:** Bearer JWT

**Response `200`:** `{ "message": "..." }`  
**Errors:** `400` — email already verified

---

## 2. Users (`/users`)

All endpoints require Bearer JWT.

---

### `GET /users/me`

**Response `200`:**
```json
{
  "id":               "cuid",
  "email":            "string",
  "username":         "string",
  "role":             "LEARNER | ADMIN",
  "isActive":         "boolean",
  "isEmailVerified":  "boolean",
  "lastLogin":        "ISO datetime | null",
  "createdAt":        "ISO datetime",
  "profile": {
    "fullName":                    "string | null",
    "displayName":                 "string | null",
    "avatarUrl":                   "string | null",
    "country":                     "string | null",
    "timezone":                    "string | null",
    "targetExamId":                "cuid | null",
    "targetExamYear":              "integer | null",
    "preparationStage":            "BEGINNER | INTERMEDIATE | ADVANCED | null",
    "studyGoal":                   "string | null",
    "preferredSubjects":           "string[] | null",
    "preferredDifficultyBias":     "EASY | MEDIUM | HARD | MIXED | null",
    "dailyStudyTimeTargetMinutes": "integer | null",
    "notificationPreferences":     "object | null",
    "preferredLanguage":           "string | null",
    "onboardingCompleted":         "boolean",
    "onboardingStep":              "integer | null",
    "initialDiagnosticTestId":     "string | null"
  }
}
```

---

### `PATCH /users/me/profile`

**Auth:** Bearer JWT

**Request body** (all fields optional):
```json
{
  "fullName":                    "string?",
  "displayName":                 "string?",
  "avatarUrl":                   "string?",
  "country":                     "string?",
  "timezone":                    "string?",
  "targetExamId":                "string?",
  "targetExamYear":              "integer? (2020–2100)",
  "preparationStage":            "BEGINNER | INTERMEDIATE | ADVANCED",
  "studyGoal":                   "string?",
  "preferredSubjects":           "string[]?",
  "preferredDifficultyBias":     "EASY | MEDIUM | HARD | MIXED",
  "dailyStudyTimeTargetMinutes": "integer? (0–1440)",
  "notificationPreferences":     "object?",
  "preferredLanguage":           "string?",
  "onboardingCompleted":         "boolean?",
  "onboardingStep":              "integer?",
  "initialDiagnosticTestId":     "string?"
}
```

**Response `200`:** Full `GET /users/me` shape.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | `targetExamId` references an exam that doesn't exist or is inactive |

---

### `PATCH /users/me/context`

**Auth:** Bearer JWT

**Request body** (all optional):
```json
{ "targetExamId": "string?", "targetExamYear": "integer? (2020–2100)" }
```

**Response `200`:** Full `GET /users/me` shape.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Invalid or inactive `targetExamId` |

---

### `PATCH /users/:id/suspend`

**Auth:** Bearer JWT + **ADMIN role**

**Response `200`:** `{ "message": "User suspended successfully" }`

**Side effect:** All active `Session` rows for this user are immediately deleted — refresh tokens are invalidated instantly (existing JWTs remain valid until their expiry window).

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | User is already suspended (`isActive` is `false`) |
| `404` | User not found |

---

### `PATCH /users/:id/activate`

**Auth:** Bearer JWT + **ADMIN role**

**Response `200`:** `{ "message": "User activated successfully" }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | User is already active (`isActive` is `true`) |
| `404` | User not found |

---

## 3. Exams & Blueprints (`/exams`)

All require Bearer JWT. Write operations also require **ADMIN role**.

---

### `POST /exams`

**Auth:** ADMIN

**Request body:**
```json
{
  "name":        "string (required, globally unique)",
  "description": "string?",
  "isActive":    "boolean? (default: true)"
}
```

**Response `201`:**
```json
{ "id": "cuid", "name": "string", "description": "string | null", "isActive": "boolean" }
```

---

### `GET /exams`

**Auth:** Any authenticated user

**Response `200`:** Array of exams, each with `_count.blueprints`.

---

### `GET /exams/:id`

**Auth:** Any authenticated user

**Response `200`:** Exam object with nested `blueprints[]` (ordered descending by version).

**Errors:** `404` — exam not found

---

### `PATCH /exams/:id`

**Auth:** ADMIN

**Request body** (all optional):
```json
{ "name": "string?", "description": "string?", "isActive": "boolean?" }
```

**Response `200`:** Updated exam record.

---

### `DELETE /exams/:id`

**Auth:** ADMIN

**Response `200`:** `{ "message": "Exam deleted successfully" }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Exam has one or more associated `Test` records |
| `404` | Exam not found |

---

### `POST /exams/:id/blueprints`

**Auth:** ADMIN

**Request body:**
```json
{
  "version":                "integer (required)",
  "defaultDurationSeconds": "integer",
  "effectiveFrom":          "ISO date string",
  "effectiveTo":            "ISO date string? (null = open-ended)",
  "sections": [
    {
      "subject":                 "string",
      "sequence":                "integer",
      "sectionDurationSeconds":  "integer?",
      "questionCount":           "integer? (default: 30)",
      "marksPerQuestion":        "number? (default: 4)"
    }
  ],
  "rules": [
    {
      "totalTimeSeconds":  "integer",
      "negativeMarking":   "boolean",
      "negativeMarkValue": "number?",
      "partialMarking":    "boolean",
      "adaptiveAllowed":   "boolean",
      "effectiveFrom":     "ISO date string",
      "effectiveTo":       "ISO date string?"
    }
  ]
}
```

**Response `201`:** Blueprint with nested `sections[]` and `rules[]`.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Missing `version`, invalid body, or validation failure |
| `404` | Exam not found |
| DB conflict | Duplicate `(examId, version)` combination |

---

### `GET /exams/blueprints/:id`

**Auth:** Any authenticated user

**Response `200`:** Blueprint with `sections[]` (ordered by sequence asc) and `rules[]`.

**Errors:** `404`

---

### `GET /exams/:id/blueprints/active`

**Auth:** Any authenticated user

**Response `200`:** The blueprint where `effectiveFrom ≤ now ≤ effectiveTo` (or `effectiveTo` is null), with the highest version winning. Returns `null` if no active blueprint.

---

### `POST /exams/blueprints/:id/activate`

**Auth:** ADMIN

**Request body:**
```json
{ "effectiveFrom": "ISO date string", "effectiveTo": "ISO date string?" }
```

**Response `201`:** Updated blueprint record.

---

### `POST /exams/blueprints/:id/archive`

**Auth:** ADMIN

**Response `201`:** Blueprint with `effectiveTo` set to current timestamp.

---

### `DELETE /exams/blueprints/:id`

**Auth:** ADMIN

**Response `200`:** `{ "message": "Blueprint deleted successfully" }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | One or more tests reference this blueprint |
| `404` | Blueprint not found |

---

## 4. Subscriptions (`/subscriptions`)

All require Bearer JWT.

---

### Subscription Pack — Admin Endpoints

#### `POST /subscriptions/packs`

**Auth:** ADMIN

**Request body:**
```json
{
  "examId":      "string",
  "name":        "string",
  "durationDays": "number",
  "price":        "number",
  "isActive":     "boolean? (default: true)"
}
```

**Response `201`:** `SubscriptionPack` record.

**Errors:** `404` — exam not found; `403` — non-admin caller

---

#### `PATCH /subscriptions/packs/:id`

**Auth:** ADMIN

**Request body** (all optional):
```json
{ "name": "string?", "durationDays": "number?", "price": "number?", "isActive": "boolean?" }
```

**Response `200`:** Updated pack.

---

#### `PATCH /subscriptions/packs/:id/toggle`

**Auth:** ADMIN

**Response `200`:** Pack with `isActive` flipped.

---

### Subscription Pack — Read Endpoints

| Method | Path | Auth | Description | Response |
|--------|------|------|-------------|---------|
| `GET` | `/subscriptions/packs` | Any | All packs (includes `exam` + `_count.subscriptions`) | `200` array |
| `GET` | `/subscriptions/packs/exam/:examId` | Any | Packs for a specific exam | `200` array |
| `GET` | `/subscriptions/packs/:id` | Any | Single pack with `exam` | `200` or `404` |

---

### User Subscription Endpoints

#### `POST /subscriptions/subscribe`

**Auth:** Any authenticated user

**Request body:**
```json
{
  "packId":            "string",
  "paymentProvider":   "string?",
  "providerReference": "string?"
}
```

**Response `201`:** Subscription record with nested `pack.exam`.

**Logic:**
- Cancels any existing `ACTIVE` subscription for the same exam (renewal handling).
- `expiresAt = startedAt + pack.durationDays`.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Pack is inactive |
| `404` | Pack not found |

---

#### `GET /subscriptions/my`

**Response `200`:** Array of user's subscriptions ordered by `startedAt desc`, each including `pack.exam`.

---

#### `GET /subscriptions/my/access/:examId`

**Response `200`:** Active subscription record for the exam, or `null` if none.

---

#### `DELETE /subscriptions/my/:id/cancel`

**Response `200`:** Updated subscription with `status: "CANCELLED"`.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Subscription is not `ACTIVE` (already cancelled or expired) |
| `404` | Subscription not found or doesn't belong to caller |

---

### Admin Subscription Endpoints

#### `GET /subscriptions/admin/all`

**Auth:** ADMIN

**Query params:** `?page=1&limit=50`

**Response `200`:**
```json
{
  "total":  "integer",
  "page":   "integer",
  "limit":  "integer",
  "items":  [{ "...subscription", "pack.exam", "user.id/email/username" }]
}
```

---

#### `POST /subscriptions/admin/grant`

**Auth:** ADMIN

**Request body:**
```json
{
  "userId":               "string",
  "packId":               "string",
  "durationDaysOverride": "integer?"
}
```

**Response `201`:** New subscription with `providerReference: "ADMIN_OVERRIDE"`. Cancels any existing active subscription for the same exam first.

---

#### `POST /subscriptions/admin/expire-stale`

**Auth:** ADMIN

**Response `201`:** `{ "expired": "integer (count of expired subscriptions)" }`

---

## 5. Questions (`/questions`)

All require Bearer JWT.

---

### `POST /questions`

**Auth:** ADMIN

**Request body:**
```json
{
  "questionId":       "string (logical stable ID, e.g. PHYS-KIN-001)",
  "version":          "integer (starts at 1)",
  "subject":          "string",
  "topic":            "string",
  "subtopic":         "string",
  "difficulty":       "EASY | MEDIUM | HARD | MIXED",
  "questionType":     "MCQ | NUMERIC",
  "contentPayload": {
    "MCQ":     { "question": "string", "options": [{ "key": "A|B|C|D", "text": "string" }] },
    "NUMERIC": { "question": "string" }
  },
  "correctAnswer":    "string (MCQ: option key like 'A'; NUMERIC: numeric string)",
  "explanation":      "string",
  "marks":            "number (positive)",
  "defaultTimeSeconds": "integer? (min 1)",
  "numericTolerance": "number? (required for NUMERIC; 0 = exact match)"
}
```

**Response `201`:** Canonical `Question` record.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | MCQ `correctAnswer` key not present in options |
| `400` | NUMERIC question missing `numericTolerance` |
| `409` | Duplicate `(questionId, version)` |
| `403` | Non-admin caller |

---

### `GET /questions/:questionId`

**Auth:** Any authenticated user

**Query params:** `?version=N` (optional — defaults to latest active version)

**Response `200`:** Full `Question` record.

**Errors:** `404`

---

### `POST /questions/validate`

**Auth:** Any authenticated user

**Request body:** Same shape as `POST /questions`.

**Response `200`:**
```json
{ "valid": true, "questionId": "string", "questionType": "MCQ | NUMERIC" }
```

**Errors:** `400` — validation failure with a description of the first error

---

### `DELETE /questions/:questionId`

**Auth:** ADMIN

**Response `200`:** `{ "message": "..." }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Question is snapshotted in an existing `TestQuestion` record |
| `404` | Question not found |

---

## 6. Test Threads & Generation (`/test-threads`)

All require Bearer JWT.

---

### `POST /test-threads`

**Auth:** Any authenticated user

**Request body:**
```json
{
  "examId":     "string",
  "originType": "SYSTEM | GENERATED",
  "title":      "string",
  "baseGenerationConfig": {
    "difficulty":             "EASY | MEDIUM | HARD | MIXED (optional)",
    "difficultyDistribution": "{ easy, medium, hard } (optional)",
    "topics":                 "string[] (optional)",
    "durationSeconds":        "integer (optional, used when followsBlueprint=false)",
    "questionCount":          "integer (optional, used when followsBlueprint=false)"
  }
}
```

**Response `201`:** `TestThread` record.

**Logic:** `createdByUserId` is set to `null` for `SYSTEM` origin, otherwise the caller's userId.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Exam is inactive |
| `404` | Exam not found |

---

### `GET /test-threads/:id`

**Response `200`:** Thread with `exam` and `tests[]` (version list, ordered desc by `versionNumber`).

**Errors:** `404`; `403` — not your thread (unless admin)

---

### `GET /test-threads/:id/latest`

**Response `200`:** Latest version `Test` summary.

**Errors:** `404` — no versions exist yet

---

### `POST /test-threads/:threadId/generate`

**Auth:** Any authenticated user (ownership enforced; ADMIN for SYSTEM threads)

**Request body:**
```json
{
  "followsBlueprint":     "boolean? (default: true)",
  "blueprintReferenceId": "string? (specific blueprint; if omitted uses active blueprint)"
}
```

**Response `201`:** `Test` record with `status: "DRAFT"`, populated `sectionSnapshot`, `ruleSnapshot`, and snapshotted `TestQuestion` records.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Thread already has a version (use `/regenerate`) |
| `400` | Exam is inactive |
| `400` | `followsBlueprint=true` but no active blueprint found |
| `403` | Not thread owner |

---

### `POST /test-threads/:threadId/regenerate`

**Auth:** Owner or ADMIN

**Request body:**
```json
{ "overrides": "object? (future use)" }
```

**Response `201`:** New `Test` with incremented `versionNumber`.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | No initial version exists (use `/generate` first) |
| `400` | Exam is inactive |

---

#### External Question Service Integration

Test generation in Quezia relies on an external Question Service for dynamic question selection. This service is configured via the environment variable:

    QUESTION_SERVICE_URL=https://your-question-service.example.com

When generating or regenerating a test version, Quezia POSTs the following payload to:

    POST {QUESTION_SERVICE_URL}/questions/fetch
    Content-Type: application/json

    {
      "prompt": "I want 10 questions of thermo",
      "tags": [
        { "difficulty": "medium" },
        { "topic": "thermodynamics" },
        { "count": 10 }
      ]
    }

**Payload Fields:**
- `prompt` (string): User's natural language request (e.g., "I want 10 questions of thermo").
- `tags` (array of objects): Each tag is a key-value pair specifying a filter or constraint (e.g., `{ "difficulty": "medium" }`).
  - Common tags: `difficulty`, `topic`, `subtopic`, `questionType`, `count`, `examId`, `seed`, `exclude` (list of question IDs).

**Response:** Array of question objects matching the requested criteria.

If `QUESTION_SERVICE_URL` is not set or the service is unavailable, test generation will fail with `503 Service Unavailable`.

---

## 7. Tests (`/tests`)

All require Bearer JWT.

---

### `GET /tests/:id`

**Response `200`:** Full test including `thread`, `questions[]` (ordered by `sequence` asc).

**Errors:** `404`; `403` — not your thread (unless admin)

---

### `GET /tests/:id/questions`

**Response `200`:** Array of snapshotted `TestQuestion` records (includes `correctAnswer` and `explanation` — intended for admin/generator use).

---

### `POST /tests/:id/questions`

**Auth:** Owner or ADMIN (test must be `DRAFT`)

**Request body:**
```json
{
  "sectionId": "string (from test's sectionSnapshot)",
  "questions": [
    {
      "questionId":       "string",
      "questionType":     "MCQ | NUMERIC",
      "subject":          "string",
      "topic":            "string",
      "subtopic":         "string",
      "difficulty":       "EASY | MEDIUM | HARD | MIXED",
      "contentPayload":   "object",
      "correctAnswer":    "string",
      "explanation":      "string",
      "marks":            "number",
      "defaultTimeSeconds":  "integer?",
      "numericTolerance": "number?",
      "negativeMarkValue": "number? (per-question override)"
    }
  ]
}
```

**Response `201`:** Array of created `TestQuestion` records.

**Errors:** `400` — test not in DRAFT status; section not found in snapshot; marks mismatch

---

### `DELETE /tests/:id/questions/:questionSnapshotId`

**Auth:** Owner or ADMIN (test must be `DRAFT`)

**Response `200`:** `{ "message": "..." }`. Sequences are automatically compacted after removal.

**Errors:** `400` — test not DRAFT or has completed attempts

---

### `PATCH /tests/:id/questions/reorder`

**Auth:** Owner or ADMIN

**Request body:**
```json
{ "orderedIds": ["testQuestionId1", "testQuestionId2", "..."] }
```

**Response `200`:** Reordered questions.

---

### `PATCH /tests/:id/publish`

**Auth:** ADMIN

**Pre-conditions (all must pass):**
1. Status must be `DRAFT`
2. `durationSeconds` must be > 0
3. Actual question count === `test.totalQuestions`
4. Sum of question marks === `test.totalMarks`
5. Per-section question counts match `sectionSnapshot`

**Response `200`:** Test with `status: "PUBLISHED"`.

**Errors:** `400` — any pre-condition fails; `403` — non-admin

---

### `PATCH /tests/:id/archive`

**Auth:** ADMIN

**Response `200`:** Test with `status: "ARCHIVED"`.

---

### `DELETE /tests/:id`

**Auth:** ADMIN

**Response `200`:** `{ "message": "..." }`

**Errors:** `400` — test has one or more attempts

---

## 8. Attempts (`/attempts`)

All require Bearer JWT.

---

### `POST /attempts/:testId/start`

**Idempotent:** Returns the existing `ACTIVE` attempt if one already exists (race-safe via `SERIALIZABLE` transaction).

**Subscription gate:** `SYSTEM` origin tests require an active subscription for the exam. `GENERATED` tests are freely accessible. Admins are always exempt.

**Response `201`:**
```json
{
  "id":     "cuid",
  "status": "ACTIVE"
}
```

> **Note:** Only `id` and `status` are returned. Use `GET /attempts/:id` to retrieve the full attempt record.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Test is not `PUBLISHED` |
| `400` | Test is `ARCHIVED` |
| `403` | No active subscription for the exam (SYSTEM tests only) |
| `404` | Test not found |

---

### `GET /attempts/:id`

**Response `200`:**
```json
{
  "id":               "cuid",
  "testId":           "cuid",
  "userId":           "cuid",
  "status":           "ACTIVE | COMPLETED",
  "startedAt":        "ISO datetime",
  "completedAt":      "ISO datetime | null",
  "totalScore":       "Decimal | null",
  "accuracy":         "Decimal | null",
  "percentile":       "Decimal | null",
  "userRank":         "integer | null",
  "timeSpentSeconds": "integer | null",
  "riskRatio":        "Decimal | null"
}
```

**Errors:** `404`; `403` — not your attempt

---

### `GET /attempts/:id/questions`

**Response `200`:** Array of test questions for this attempt. **Correct answers and explanations are omitted.** Field is named `contentPayload` (not `contentSnapshot`) for API contract consistency.

```json
[
  {
    "id":           "cuid",
    "questionId":   "string",
    "sectionId":    "string | null",
    "subject":      "string",
    "topic":        "string",
    "difficulty":   "EASY | MEDIUM | HARD | MIXED",
    "questionType": "MCQ | NUMERIC",
    "contentPayload": "object",
    "marks":        "Decimal",
    "sequence":     "integer"
  }
]
```

---

### `POST /attempts/:id/submit`

**Request body:**
```json
{ "questionId": "string (logical questionId)", "answer": "string" }
```

**Response `201`:** Upserted `TestAttemptQuestion` record.

**Logic:** Fully idempotent upsert — submitting the same question again **overwrites** the previous answer. Only the last-submitted answer counts in grading.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Attempt is not `ACTIVE` |
| `404` | Question not found in this test |
| `403` | Not your attempt |

---

### `POST /attempts/:id/submit-test`

**Triggers full grading + analytics pipeline inside a single atomic transaction.**

**Grading pipeline:**
1. `GradingService.calculateAttemptScore()` — deterministic, snapshot-based
2. Updates `TestAttempt`: `status → COMPLETED`, sets `totalScore`, `accuracy`, `riskRatio`
3. Inside the **same transaction**, `AnalyticsService.updateAll()`:
   - Creates/updates `UserExamAnalytics` (incremental rolling averages)
   - Creates/updates `UserSubjectAnalytics`
   - Creates/updates `UserTopicAnalytics` (with `healthStatus` from Topic Health Engine)
   - Creates `PerformanceTrend` row
   - For `SYSTEM` tests: updates `PeerBenchmark`, computes `percentile` + `userRank`

**Response `200`:**
```json
{
  "id":               "cuid",
  "testId":           "cuid",
  "userId":           "cuid",
  "status":           "COMPLETED",
  "startedAt":        "ISO datetime",
  "completedAt":      "ISO datetime",
  "totalScore":       "Decimal",
  "accuracy":         "Decimal",
  "percentile":       "Decimal | null",
  "userRank":         "integer | null",
  "timeSpentSeconds": "integer | null",
  "riskRatio":        "Decimal"
}
```

> **Note:** `percentile` and `userRank` are only populated for `SYSTEM` origin tests. `GENERATED` tests return `null` for both.

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Attempt is already `COMPLETED` |
| `403` | Not your attempt |

---

## 9. Analytics (`/analytics`)

All require Bearer JWT. All endpoints are **scoped to the calling user**.

---

### `GET /analytics/exam/:examId`

**Response `200`:**
```json
{
  "exam": { "id": "cuid", "name": "string", "isActive": "boolean" },
  "overallAccuracy":        "Decimal",
  "averageScore":           "Decimal",
  "bestRank":               "integer | null",
  "currentStreak":          "integer",
  "totalAttempts":          "integer",
  "lastAttemptAt":          "ISO datetime | null",
  "averageTimePerQuestion": "Decimal",
  "weakestSubject":         "string | null",
  "riskRatio":              "Decimal",
  "riskClassification":     "Very Aggressive | Aggressive | Balanced | Cautious",
  "inefficiencyIndex":      "Decimal"
}
```

> **Zero-state safe:** If the user has no attempts, returns only `{ "exam": {...} }` — no crash.

---

### `GET /analytics/exam/:examId/subjects`

**Response `200`:** Array of `UserSubjectAnalytics` ordered by `accuracy desc`:
```json
[
  {
    "subject":          "string",
    "accuracy":         "Decimal",
    "attempts":         "integer",
    "averageTime":      "Decimal",
    "trendDelta":       "Decimal",
    "consistencyScore": "Decimal",
    "lastTestedAt":     "ISO datetime | null"
  }
]
```

---

### `GET /analytics/exam/:examId/topics`

**Response `200`:** Array of `UserTopicAnalytics` ordered by `accuracy desc`:
```json
[
  {
    "subject":          "string",
    "topic":            "string",
    "accuracy":         "Decimal",
    "attempts":         "integer",
    "averageTime":      "Decimal",
    "negativeRate":     "Decimal",
    "easyAccuracy":     "Decimal",
    "mediumAccuracy":   "Decimal",
    "hardAccuracy":     "Decimal",
    "consistencyScore": "Decimal",
    "trendDelta":       "Decimal",
    "healthStatus":     "STABLE | IMPROVING | VOLATILE | WEAK",
    "lastTestedAt":     "ISO datetime | null"
  }
]
```

---

### `GET /analytics/exam/:examId/trend`

**Response `200`:** Array of `PerformanceTrend` ordered by `testDate asc`:
```json
[
  {
    "id":        "cuid",
    "userId":    "cuid",
    "examId":    "cuid",
    "attemptId": "cuid | null",
    "testDate":  "ISO datetime",
    "score":     "Decimal",
    "accuracy":  "Decimal",
    "percentile":"Decimal"
  }
]
```

---

### `GET /analytics/exam/:examId/benchmark`

**Response `200`:**
```json
{
  "userScore": "Decimal | null",
  "benchmark": {
    "percentileBands":   "object",
    "subjectAverages":   "object",
    "scoreDistribution": "object",
    "totalParticipants": "integer",
    "computedAt":        "ISO datetime",
    "lastRecalculatedAt":"ISO datetime | null"
  }
}
```

---

## 10. Admin (`/admin`)

All require Bearer JWT + **ADMIN role**. All actions are logged via `AuditLogInterceptor`.

---

### `GET /admin/analytics/system`

**Response `200`:**
```json
{
  "users":    { "total": "integer", "active": "integer", "inactive": "integer" },
  "exams":    { "total": "integer" },
  "tests":    { "total": "integer", "published": "integer", "draft": "integer" },
  "attempts": { "total": "integer", "completed": "integer", "active": "integer" }
}
```

---

### `GET /admin/analytics/exam/:examId`

**Response `200`:**
```json
{
  "exam":                { "id", "name", "isActive" },
  "tests":               "integer",
  "threads":             "integer",
  "blueprints":          "integer",
  "activeSubscriptions": "integer",
  "attempts": {
    "total":          "integer",
    "avgScore":       "number",
    "avgAccuracy":    "number",
    "avgTimeSeconds": "integer"
  },
  "peerBenchmarks": [
    { "blueprintVersion": "integer | null", "totalParticipants": "integer", "lastUpdated": "ISO datetime" }
  ]
}
```

---

### `GET /admin/users`

**Query params:** `?page=1&limit=20&role=ADMIN|LEARNER&isActive=true|false&search=string`

**Response `200`:**
```json
{
  "users": [
    {
      "id", "email", "username", "role", "isActive",
      "createdAt", "lastLogin", "isEmailVerified",
      "_count": { "attempts": "integer", "subscriptions": "integer" }
    }
  ],
  "pagination": { "total", "page", "limit", "totalPages" }
}
```

---

### `GET /admin/users/:userId`

**Response `200`:** Full user with:
- `profile` (including `targetExam`)
- Last 10 `subscriptions` (with `pack.exam`)
- Last 10 completed `attempts` (with `test.exam`)
- `_count` of attempts, sessions, authLogs

**Errors:** `404`

---

### `POST /admin/users/:userId/suspend`

**Body:** `{ "reason": "string?" }`

**Response `200`:** `{ "message": "User suspended successfully" }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Cannot suspend admin users |
| `404` | User not found |

---

### `POST /admin/users/:userId/activate`

**Response `200`:** `{ "message": "User activated successfully" }`

**Errors:** `404`

---

### `DELETE /admin/users/:userId`

**GDPR cascade delete** — removes user and all related records via DB cascade constraints.

**Response `200`:** `{ "message": "User data deleted successfully" }`

**Errors:**
| Status | Condition |
|--------|-----------|
| `400` | Cannot delete admin users |
| `404` | User not found |

---

### `GET /admin/audit-logs`

**Query params:** `?page=1&limit=50&userId&event&startDate&endDate`

**Response `200`:**
```json
{
  "logs": [
    {
      "id", "userId", "event", "status",
      "ipAddress", "deviceInfo", "metadata", "createdAt",
      "user": { "id", "email", "username" }
    }
  ],
  "pagination": { "total", "page", "limit", "totalPages" }
}
```

**Auth event types:** `REGISTER` · `LOGIN` · `LOGOUT` · `PASSWORD_RESET_REQUEST` · `PASSWORD_RESET_SUCCESS` · `EMAIL_VERIFICATION_REQUEST` · `EMAIL_VERIFICATION_SUCCESS` · `ACCOUNT_SUSPENDED` · `ACCOUNT_ACTIVATED`

---

### `GET /admin/tests/statistics`

**Query params:** `?examId` (optional filter)

**Response `200`:**
```json
{
  "summary": {
    "total": "integer",
    "byStatus":     { "DRAFT": "integer", "PUBLISHED": "integer", "ARCHIVED": "integer" },
    "byDifficulty": { "EASY": "integer", "MEDIUM": "integer", "HARD": "integer", "MIXED": "integer" },
    "totalAttempts": "integer"
  },
  "tests": [
    { "id", "status", "difficulty", "totalQuestions", "totalMarks", "exam", "_count.attempts" }
  ]
}
```

---

### `GET /admin/tests/:testId/performance`

**Response `200`:**
```json
{
  "test":     { "id", "status", "exam" },
  "attempts": "integer",
  "stats": {
    "score":          { "avg": "number", "min": "number", "max": "number" },
    "accuracy":       { "avg": "number", "min": "number", "max": "number" },
    "avgTimeSeconds": "number"
  }
}
```

> Returns `{ "test": {...}, "attempts": 0, "stats": null }` when no completed attempts exist.

---

### `PATCH /admin/tests/:testId/visibility`

**Body:** `{ "status": "PUBLISHED" | "ARCHIVED" }`

**Response `200`:** Updated test record. Force override — bypasses normal state machine.

---

## Grading Engine

Lives in `GradingService`. Runs entirely off **immutable snapshots** — immune to any blueprint or question registry changes after the test was generated.

### Scoring Rules

| Question Type | Outcome | Marks Awarded |
|--------------|---------|---------------|
| MCQ | Correct (exact match) | `+marks` |
| MCQ | Incorrect | `-negativeMarkValue` (if `negativeMarking = true`) |
| MCQ | Unattempted | `0` |
| NUMERIC | Correct: `|answer - correct| ≤ tolerance` | `+marks` |
| NUMERIC | Near miss: `|diff| ≤ tolerance × 2` | `+marks × 0.5` (if `partialMarking = true`) |
| NUMERIC | Incorrect | `-negativeMarkValue` (if `negativeMarking = true`) |
| Any | Unattempted | `0` |

> Per-question `negativeMarkValue` overrides the rule-level value when set on `TestQuestion`.

### Computed Metrics

| Metric | Formula |
|--------|---------|
| `accuracy` | `(correctCount / totalQuestions) × 100` |
| `riskRatio` | `(incorrectCount × negativeMarkValue) / totalScore` |
| `riskClassification` | `≥ 2.0` → Very Aggressive · `≥ 1.0` → Aggressive · `≤ 0.3` → Cautious · else Balanced |
| `percentile` | Computed from `PeerBenchmark` — SYSTEM tests only |
| `userRank` | Position among all unique scorers — SYSTEM tests only |

### Analytics Written Per Attempt Completion (Atomic Transaction)

```
TestAttempt          ← status, score, accuracy, riskRatio, percentile, userRank
UserExamAnalytics    ← rolling averages: averageScore, overallAccuracy, averageTimePerQuestion,
                       riskRatio, inefficiencyIndex, currentStreak, totalAttempts
UserSubjectAnalytics ← per-subject accuracy, averageTime, trendDelta, consistencyScore
UserTopicAnalytics   ← per-topic accuracy, negativeRate, difficulty splits,
                       trendDelta, consistencyScore, healthStatus
PerformanceTrend     ← one row per completed attempt
PeerBenchmark        ← updated only for SYSTEM tests
```

---

## Data Model Relationships

```
User (1) ──── Session[]              userId → User.id  (CASCADE DELETE)
User (1) ──── UserProfile (1:1)      userId → User.id  (CASCADE DELETE)
User (1) ──── UserSubscription[]     userId → User.id  (CASCADE DELETE)
User (1) ──── TestAttempt[]          userId → User.id
User (1) ──── TestThread[]           createdByUserId → User.id  (nullable)
User (1) ──── UserExamAnalytics[]    userId → User.id  (CASCADE DELETE)
User (1) ──── InsightLog[]           userId → User.id  (CASCADE DELETE)
User (1) ──── AuthAuditLog[]         userId → User.id  (SET NULL)

Exam (1) ──── ExamBlueprint[]        examId → Exam.id  (CASCADE DELETE)
Exam (1) ──── SubscriptionPack[]     examId → Exam.id
Exam (1) ──── TestThread[]           examId → Exam.id
Exam (1) ──── Test[]                 examId → Exam.id
Exam (1) ──── UserExamAnalytics[]    examId → Exam.id
Exam (1) ──── InsightLog[]           examId → Exam.id
UserProfile.targetExamId → Exam.id  (nullable)

ExamBlueprint (1) ──── ExamBlueprintSection[]  blueprintId (CASCADE DELETE)
ExamBlueprint (1) ──── ExamRule[]              blueprintId (CASCADE DELETE)

TestThread (1) ──── Test[]           threadId → TestThread.id  (CASCADE DELETE)

Test (1) ──── TestQuestion[]         testId → Test.id  (CASCADE DELETE)  ← IMMUTABLE SNAPSHOT
Test (1) ──── TestAttempt[]          testId → Test.id

TestAttempt (1) ──── TestAttemptQuestion[]   attemptId (CASCADE DELETE)
TestQuestion (1) ──── TestAttemptQuestion[]  testQuestionId → TestQuestion.id

SubscriptionPack (1) ──── UserSubscription[]  packId

Question  — standalone canonical registry
            TestQuestion.questionId is a LOGICAL string, NOT a foreign key reference
            (snapshot immutability is maintained independently of the registry)
```

---

## Key Business Rules

1. **Test status machine:** `DRAFT → PUBLISHED → ARCHIVED`. Only admins can advance status. The publish step validates structural integrity (question count, marks sum, section distribution).

2. **Subscription gating:** `SYSTEM` tests require a valid `UserSubscription` (status `ACTIVE` + `expiresAt > now`) for the exam. `GENERATED` tests are freely accessible to any authenticated user. Admins are always exempt.

3. **Refresh token rotation:** Using a refresh token **deletes** the `Session` row. Reuse of a consumed token returns `401`. Concurrent requests using the same token: only one succeeds, the other retries and finds the new session.

4. **Attempt idempotency:** Calling `POST /attempts/:testId/start` when an `ACTIVE` attempt already exists returns that existing attempt (same `id`) rather than creating a new one. Implemented via a `SERIALIZABLE` transaction to handle race conditions.

5. **Answer idempotency:** `POST /attempts/:id/submit` is an upsert on `(attemptId, testQuestionId)` — only the last answer counts for grading.

6. **Snapshot immutability:** Once a `TestQuestion` row is created, it carries a complete snapshot of the question content, marks, rules, and tolerances. Subsequent changes to the canonical `Question` or `ExamBlueprint` have **no effect** on already-generated tests.

7. **NUMERIC tolerance:** `numericTolerance` must be provided (≥ 0) for all `NUMERIC` questions. Absence causes a `400` at validation. Tolerance `0` requires an exact match.

8. **Deletion constraints:**
   - `DELETE /exams/:id` → `400` if tests exist for that exam
   - `DELETE /exams/blueprints/:id` → `400` if tests reference that blueprint
   - `DELETE /questions/:questionId` → `400` if question is snapshotted in any test
   - `DELETE /tests/:id` → `400` if attempts exist for that test

9. **Atomic analytics:** Grading and all analytics writes happen inside a single Prisma transaction (30s timeout). A partial failure rolls back everything — a `COMPLETED` attempt always has complete analytics or none at all.

10. **Inactive exam lock:** Threads and test versions cannot be created for inactive exams. The exam `isActive` flag is evaluated at creation time, not at runtime.

11. **SYSTEM vs GENERATED origin:**
    - `SYSTEM` — admin-curated, requires subscription, generates `percentile` and `userRank`
    - `GENERATED` — user-initiated (learner can create), no subscription needed, no peer benchmarking
