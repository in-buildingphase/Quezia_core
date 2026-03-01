# Quezia Core — API Reference

> Scanned from all controllers, services, and `scripts/test-system.sh`.  
> Base URL: `http://localhost:3000`

---

## Global Guards & Conventions

| Mechanism | Description |
|---|---|
| `JwtAuthGuard` | Validates `Authorization: Bearer <accessToken>`. Applied globally; routes opt-out with `@Public()`. |
| `RolesGuard` | Checks `user.role` against `@Roles(...)`. Must be combined with `JwtAuthGuard`. |
| `AuditLogInterceptor` | Logs every admin action. Applied at controller level on `/admin`. |
| `@Public()` | Bypasses JWT validation entirely. |
| `@CurrentUser()` | Extracts `{ userId, role }` from the validated JWT. |

HTTP response codes follow NestJS defaults unless `@HttpCode(...)` overrides them.

---

## § 1 — Auth & User Profile

### POST `/auth/register`
- **Guard:** `@Public()`
- **Response:** `201 Created`
- **Request body:**
  ```json
  { "email": "string", "username": "string (3–50 chars)", "password": "string (≥8, must contain upper + lower + digit)" }
  ```
- **Response body:**
  ```json
  { "accessToken": "string", "refreshToken": "string", "user": { "id": "uuid", "email": "string", "role": "LEARNER|ADMIN" } }
  ```
- **Errors:** `409` — email or username already exists.
- **Side effects:** Creates `UserProfile` row. Logs `REGISTER` + `LOGIN` auth events.

---

### POST `/auth/login`
- **Guard:** `@Public()`
- **Response:** `200 OK`
- **Request body:**
  ```json
  { "email": "string", "password": "string" }
  ```
- **Response body:**
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "user": {
      "id": "uuid",
      "email": "string",
      "role": "LEARNER|ADMIN"
    }
  }
  ```

- **Errors:**
  - `401` — invalid credentials or account deactivated.
  - `429 Too Many Requests` — account locked after **5 failed attempts** for **15 minutes**. Body includes `{ "retryAfterSeconds": number }`.
- **Side effects:** Resets `failedLoginAttempts` and `lockedUntil` on success. Updates `lastLogin`.

---

### POST `/auth/refresh`
- **Guard:** `@Public()`
- **Response:** `200 OK`
- **Request body:**
  ```json
  { "refreshToken": "string" }
  ```
- **Response body:**
  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "user": {
      "id": "uuid",
      "email": "string",
      "role": "LEARNER|ADMIN"
    }
  }
  ```

- **Errors:** `401` — invalid, expired, or already-rotated token.
- **Token rotation:** The old refresh token is immediately invalidated. Concurrent use of the same refresh token results in exactly one success (serializable).

---

### POST `/auth/logout`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Request body:**
  ```json
  { "refreshToken": "string" }
  ```
- **Response body:** `{ "message": "Logged out successfully" }`
- **Side effects:** Deletes the session whose refresh-token hash matches. Subsequent refresh with the same token → `401`.

---

### POST `/auth/forgot-password`
- **Guard:** `@Public()`
- **Response:** `200 OK` **always** (anti-enumeration — same response whether email exists or not).
- **Request body:** `{ "email": "string" }`
- **Response body:** `{ "message": "If that email address is in our database, we will send you an email…" }`
- **Side effects:** Generates `resetPasswordToken` (expires in 1 hour). Currently logs token to console (no email service wired).

---

### POST `/auth/reset-password`
- **Guard:** `@Public()`
- **Response:** `200 OK`
- **Request body:** `{ "token": "string", "newPassword": "string (≥8 chars)" }`
- **Response body:** `{ "message": "Password has been updated" }`
- **Errors:** `400` — invalid or expired token.
- **Side effects:** All active sessions for that user are deleted on success.

---

### POST `/auth/verify-email`
- **Guard:** `@Public()`
- **Response:** `200 OK`
- **Request body:** `{ "token": "string" }`
- **Errors:** `400` — token not found.

---

### POST `/auth/resend-verification`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Request body:** none
- **Response body:** `{ "message": "..." }`

---

### GET `/users/me`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "id": "uuid", "email": "string", "username": "string",
    "role": "LEARNER|ADMIN", "isActive": true, "isEmailVerified": false,
    "lastLogin": "ISO date", "createdAt": "ISO date",
    "profile": {
      "fullName": "string|null", "displayName": "string|null", "avatarUrl": "string|null",
      "country": "string|null", "timezone": "string|null",
      "targetExamId": "uuid|null", "targetExamYear": "number|null",
      "preparationStage": "enum|null", "studyGoal": "string|null",
      "preferredSubjects": [], "preferredDifficultyBias": "string|null",
      "dailyStudyTimeTargetMinutes": "number|null",
      "notificationPreferences": {}, "preferredLanguage": "string|null",
      "onboardingCompleted": false, "onboardingStep": "number|null",
      "initialDiagnosticTestId": "uuid|null"
    }
  }
  ```

---

### PATCH `/users/me/context`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Request body:**
  ```json
  { "targetExamId": "uuid (optional)", "targetExamYear": "number (optional)" }
  ```
- **Response body:** Full user and profile object (see `GET /users/me`).
- **Errors:** `400` — exam not found or not active.

---

### PATCH `/users/me/profile`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Request body:** All fields optional:
  ```json
  {
    "fullName": "string", "displayName": "string", "avatarUrl": "string",
    "country": "string", "timezone": "string",
    "targetExamId": "uuid", "targetExamYear": "number (2020–2100)",
    "preparationStage": "BEGINNER|INTERMEDIATE|ADVANCED",
    "studyGoal": "string", "preferredSubjects": [],
    "preferredDifficultyBias": "EASY|MEDIUM|HARD|MIXED",
    "dailyStudyTimeTargetMinutes": "number (0–1440)",
    "notificationPreferences": {},
    "preferredLanguage": "string",
    "onboardingCompleted": "boolean", "onboardingStep": "number",
    "initialDiagnosticTestId": "string"
  }
  ```
- **Response body:** Full user and profile object (see `GET /users/me`).
- **Errors:** `400` — invalid `targetExamId`.

---

### PATCH `/users/:id/suspend`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** `{ "message": "User suspended successfully" }`
- **Errors:** `400` — already suspended. `404` — user not found.
- **Side effects:** Sets `isActive = false`. Deletes **all active sessions** immediately (handled via single transaction). Logs `ACCOUNT_SUSPENDED` event.
- **Admin Note:** This is the primary suspension endpoint for immediate session termination.


---

### PATCH `/users/:id/activate`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** `{ "message": "User activated successfully" }`
- **Errors:** `400` — already active. `404` — user not found.
- **Side effects:** Logs `ACCOUNT_ACTIVATED` event.

---

## § 2 — Exams & Blueprints

All `/exams` endpoints require `JwtAuthGuard + RolesGuard`.  
Read endpoints (`GET`) are accessible to any authenticated user. Write/delete endpoints require `@Roles('admin')`.

---

### POST `/exams`
- **Role:** admin
- **Response:** `201 Created`
- **Request body:** `{ "name": "string", "description": "string (optional)", "isActive": "boolean (default true)" }`
- **Response body:** `{ "id": "uuid", "name": "string", "description": "string|null", "isActive": true, "createdAt": "..." }`

---

### GET `/exams`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Array of exams, each including `_count.blueprints`.

---

### GET `/exams/:id`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Exam object including `blueprints[]` array ordered by `version desc`.
- **Errors:** `404` — exam not found.

---

### PATCH `/exams/:id`
- **Role:** admin
- **Response:** `200 OK`
- **Request body:** `{ "name": "string (optional)", "description": "string (optional)", "isActive": "boolean (optional)" }`
- **Response body:** Updated exam.
- **Errors:** `404` — exam not found.

---

### DELETE `/exams/:id`
- **Role:** admin
- **Response:** `200 OK`
- **Response body:** `{ "message": "Exam deleted successfully" }`
- **Errors:** `400` — tests exist on this exam. `404` — not found.

---

### POST `/exams/:id/blueprints`
- **Role:** admin
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "version": "number (required)",
    "defaultDurationSeconds": "number",
    "effectiveFrom": "ISO date string",
    "effectiveTo": "ISO date string (optional)",
    "sections": [
      { "subject": "string", "sequence": "number", "sectionDurationSeconds": "number (optional)", "questionCount": "number (default 30)", "marksPerQuestion": "number (default 4)" }
    ],
    "rules": [
      {
        "totalTimeSeconds": "number", "negativeMarking": "boolean",
        "negativeMarkValue": "number", "partialMarking": "boolean",
        "adaptiveAllowed": "boolean", "effectiveFrom": "ISO date",
        "effectiveTo": "ISO date (optional)"
      }
    ]
  }
  ```
- **Response body:** Blueprint including `sections[]` and `rules[]`.
- **Errors:** `400` — missing required fields (e.g., `version`). `404` — parent exam not found.

---

### GET `/exams/blueprints/:id`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Blueprint with `sections[]` (ordered by `sequence asc`) and `rules[]`.
- **Errors:** `404` — not found.

---

### GET `/exams/:id/blueprints/active`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Single blueprint object (ordered by `version desc`) where `effectiveFrom ≤ now ≤ effectiveTo` (or `effectiveTo` is null). Returns `null` if none active. **Always a single object, never an array.**

---

### POST `/exams/blueprints/:id/activate`
- **Role:** admin
- **Response:** `201 Created`
- **Request body:** `{ "effectiveFrom": "ISO date", "effectiveTo": "ISO date (optional)" }`
- **Response body:** Updated blueprint.
- **Behaviour:** Sets the effective date window. Overlapping windows: system either auto-closes the previous active blueprint or rejects with `400/409`.

---

### POST `/exams/blueprints/:id/archive`
- **Role:** admin
- **Response:** `201 Created`
- **Response body:** Blueprint with `effectiveTo` set to `now`.
- **Errors:** `404` — not found.

---

### DELETE `/exams/blueprints/:id`
- **Role:** admin
- **Response:** `200 OK`
- **Response body:** `{ "message": "Blueprint deleted successfully" }`
- **Errors:** `400` — tests reference this blueprint. `404` — not found.

---

## § 3 — Subscriptions

All `/subscriptions` endpoints require `JwtAuthGuard + RolesGuard`.

---

### POST `/subscriptions/packs`
- **Role:** admin
- **Response:** `201 Created`
- **Request body:** `{ "examId": "uuid", "name": "string", "durationDays": "number", "price": "number", "isActive": "boolean (default true)" }`
- **Response body:** Pack object.
- **Errors:** `404` — exam not found.

---

### GET `/subscriptions/packs`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** All packs, each with `exam: {id, name}` and `_count.subscriptions`. Ordered by exam name.

---

### GET `/subscriptions/packs/exam/:examId`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Packs for the given exam with `_count.subscriptions`.

---

### GET `/subscriptions/packs/:id`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Pack with `exam: {id, name}`.
- **Errors:** `404` — not found.

---

### PATCH `/subscriptions/packs/:id`
- **Role:** admin
- **Response:** `200 OK`
- **Request body:** `{ "name": "string (optional)", "durationDays": "number (optional)", "price": "number (optional)", "isActive": "boolean (optional)" }`
- **Response body:** Updated pack.

---

### PATCH `/subscriptions/packs/:id/toggle`
- **Role:** admin
- **Response:** `200 OK`
- **Response body:** Pack with `isActive` flipped.

---

### POST `/subscriptions/subscribe`
- **Role:** any authenticated learner
- **Response:** `201 Created`
- **Request body:** `{ "packId": "uuid", "paymentProvider": "string (optional)", "providerReference": "string (optional)" }`
- **Response body:** Subscription including `pack.exam.{id, name}` with `status: "ACTIVE"`, `startedAt`, `expiresAt`.
- **Errors:** `400` — pack is inactive. `404` — pack not found.
- **Renewal logic:** Any existing `ACTIVE` subscriptions for the **same exam** are resolved and set to `CANCELLED` before the new one is created.
- **Expiry:** `expiresAt = now + pack.durationDays`.

---

### GET `/subscriptions/my`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** User's subscriptions ordered by `startedAt desc`, each with `pack.exam`.

---

### DELETE `/subscriptions/my/:id/cancel`
- **Role:** any authenticated (owner only)
- **Response:** `200 OK`
- **Response body:** Updated subscription with `status: "CANCELLED"`.
- **Errors:** `400` — subscription is not `ACTIVE`. `404` — not found or not owned by caller.

---

### GET `/subscriptions/my/access/:examId`
- **Role:** any authenticated
- **Response:** `200 OK`
- **Response body:** Active subscription object for this exam, or `null`.

---

### GET `/subscriptions/admin/all`
- **Role:** admin
- **Response:** `200 OK`
- **Query params:** `page (default 1)`, `limit (default 50)`
- **Response body:** `{ "total": number, "items": [...], "page": number }`

---

### POST `/subscriptions/admin/grant`
- **Role:** admin
- **Response:** `201 Created`
- **Request body:** `{ "userId": "uuid", "packId": "uuid", "durationDaysOverride": "number (optional)" }`
- **Response body:** Subscription with `providerReference: "ADMIN_OVERRIDE"`, `status: "ACTIVE"`.

---

### POST `/subscriptions/admin/expire-stale`
- **Role:** admin
- **Response:** `201 Created`
- **Response body:** `{ "expired": number }`
- **Behaviour:** Sets all `ACTIVE` subscriptions with `expiresAt < now` to `EXPIRED`. Intended for cron or on-demand admin calls.

---

## § 4 — Questions (AI External Service Registry)

All `/questions` endpoints require `JwtAuthGuard`. Write/delete requires admin role.

> Questions are **immutable** once created. Content cannot be changed in place — a new version must be posted with an incremented `version` number.

---

### POST `/questions`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "questionId": "string (canonical ID shared across versions, required)",
    "version": "number (positive integer, required)",
    "subject": "string (required)",
    "topic": "string (required)",
    "subtopic": "string (required)",
    "difficulty": "EASY|MEDIUM|HARD|MIXED",
    "questionType": "MCQ|NUMERIC",
    "contentPayload": {
      "question": "string",
      "options": [{ "key": "A", "text": "string" }, ... ]
    },
    "correctAnswer": "string (must match an option key for MCQ; numeric string for NUMERIC)",
    "explanation": "string (required)",
    "marks": "number (positive, required)",
    "numericTolerance": "number (required for NUMERIC type, min 0; use 0 for exact match)",
    "defaultTimeSeconds": "number (optional, min 1 — defaults to 60 if omitted)"
  }
  ```
- **Response body:** Persisted `Question` record.
- **Errors:**
  - `400` — validation failed (e.g., MCQ `correctAnswer` key not in options; NUMERIC missing `numericTolerance`).
  - `409` — same `questionId` + `version` already exists.
  - `403` — learner attempting to create.

---

### GET `/questions/:questionId`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Query params:** `version (optional number)` — defaults to latest active version.
- **Response body:** `Question` record including `questionId`, `difficulty`, `contentPayload`, etc.

---

### POST `/questions/validate`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Request body:** Same shape as `POST /questions` (no persistence).
- **Response body:**
  ```json
  {
    "valid": true,
    "questionId": "string",
    "questionType": "MCQ|NUMERIC"
  }
  ```

- **Errors:** `400` — first validation error found. Used by AI services to pre-check before full injection.

---

### DELETE `/questions/:questionId`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** `{ "message": "Question '...' deleted successfully" }`
- **Errors:**
  - `400` — question is referenced in one or more test snapshots (`TestQuestion`). Must archive those tests first.
  - `404` — not found.

---

## § 5 — Tests

Tests follow a **thread → version → attempt** lifecycle.  
A `TestThread` is a container. Each `generate` / `regenerate` call creates a new `Test` (version) inside that thread.

### Test Status Machine
```
DRAFT → PUBLISHED → ARCHIVED
```
- Learners can only start attempts on `PUBLISHED` tests.
- `SYSTEM` origin tests require an active subscription (learners only; admins exempt).

### `TestOriginType` Enum
| Value | Description |
|---|---|
| `SYSTEM` | Platform-managed test — subscription required |
| `GENERATED` | User/AI generated — no subscription required |

### `AttemptStatus` Enum
| Value | Description |
|---|---|
| `ACTIVE` | Attempt in progress |
| `COMPLETED` | Attempt submitted and graded |
| `ABANDONED` | Stored in schema; not currently set by any service endpoint |

### `Difficulty` Enum (tests and questions)
`EASY` | `MEDIUM` | `HARD` | `MIXED`

---

### POST `/test-threads`
- **Guard:** `JwtAuthGuard`
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "examId": "uuid (required)",
    "originType": "SYSTEM | GENERATED (required)",
    "title": "string (required)",
    "baseGenerationConfig": "object (required — use {} if no config)"
  }
  ```
- **Response body:** Thread with `id`, `examId`, `originType`.
- **Errors:** `400` — exam is not active.
- **Note:** `INJECTED` is **not** a valid `originType`. The enum only contains `SYSTEM` and `GENERATED`.

---

### GET `/test-threads/:id`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Response body:** Thread object.

---

### GET `/test-threads/:id/latest`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Response body:** Latest `Test` version inside this thread.

---

### POST `/test-threads/:threadId/generate`
- **Guard:** `JwtAuthGuard`
- **Response:** `201 Created`
- **Request body:** `{ "followsBlueprint": "boolean (optional)", "blueprintReferenceId": "uuid (optional)" }`
- **Response body:** `Test` record with `status: "DRAFT"`, `sectionSnapshot`, `ruleSnapshot`, `totalQuestions`.
- **Errors:** `400` — thread already has a version (call regenerate instead).
- **Behaviour:** When `followsBlueprint: true`, snapshots blueprint sections and rules at generation time. When `followsBlueprint: false`, creates an empty test shell ready for manual question injection.

---

### POST `/test-threads/:threadId/regenerate`
- **Guard:** `JwtAuthGuard`
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "overrides": {
      "followsBlueprint": "boolean (optional)",
      "totalQuestions": "number (optional)",
      "baseGenerationConfig": "object (optional)"
    }
  }
  ```
- **Response body:** New `Test` version (DRAFT) with `versionNumber` incremented +1 from latest.

---

### GET `/tests/:id`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Response body:** Test including `sectionSnapshot`, `ruleSnapshot`.

---

### PATCH `/tests/:id/publish`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** Test with `status: "PUBLISHED"`.

---

### PATCH `/tests/:id/archive`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** Test with `status: "ARCHIVED"`.

---

### DELETE `/tests/:id`
- **Guard:** `JwtAuthGuard` + `RolesGuard` + `@Roles('admin')`
- **Response:** `200 OK`
- **Response body:** `{ "message": "..." }`
- **Errors:** `400` — attempts exist on this test.

---

### POST `/tests/:id/questions`
- **Guard:** `JwtAuthGuard`
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "sectionId": "uuid (from sectionSnapshot)",
    "questions": [
      {
        "questionId": "string",
        "questionType": "MCQ|NUMERIC",
        "subject": "string",
        "topic": "string",
        "subtopic": "string",
        "difficulty": "EASY|MEDIUM|HARD",
        "contentPayload": { "question": "string", "options": [...] },
        "correctAnswer": "string",
        "explanation": "string",
        "marks": "number",
        "defaultTimeSeconds": "number (optional, min 1)",
        "numericTolerance": "number (optional, required for NUMERIC, min 0)",
        "negativeMarkValue": "number (optional — per-question override; falls back to ruleSnapshot if omitted)"
      }
    ]
  }
  ```
- **Behaviour:** Snapshots each question into immutable `TestQuestion` records. Validates structure against `sectionSnapshot` + `ruleSnapshot`. Test must be in `DRAFT` status.

---

### GET `/tests/:id/questions`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Response body:** Ordered (`sequence asc`) array of `TestQuestion` snapshots. Each entry has its own `contentPayload` — **not a live reference** to the canonical question.

---

### DELETE `/tests/:id/questions/:questionSnapshotId`
- **Guard:** `JwtAuthGuard`
- **Response:** `200 OK`
- **Behaviour:** Only on DRAFT tests with no completed attempts. Re-compacts `sequence` values after removal.

---

### PATCH `/tests/:id/questions/reorder`
- **Guard:** `JwtAuthGuard`
- **Request body:** `{ "orderedIds": ["uuid", ...] }` — full ordered list of TestQuestion IDs.
- **Behaviour:** Only on DRAFT tests.
- **Request body:**
  ```json
  { "orderedIds": ["uuid", ...] }
  ```

---

### POST `/attempts/:testId/start`
- **Guard:** `JwtAuthGuard`
- **Response:** `201 Created`
- **Subscription gating:**
  - `SYSTEM` tests → requires active subscription for the exam (admins exempt).
  - `GENERATED` tests → any authenticated user.
- **Idempotency:** If an `ACTIVE` attempt already exists for this user+test, it is returned. Uses a `SERIALIZABLE` transaction to prevent race-condition duplicates.
- **Response body:** `{ "id": "uuid", "status": "ACTIVE" }`
- **Errors:** `400` — test not `PUBLISHED`. `403` — no active subscription (SYSTEM test).

---

### GET `/attempts/:id`
- **Guard:** `JwtAuthGuard` (owner only — `ForbiddenException` if not owner)
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "id": "uuid", "testId": "uuid", "userId": "uuid",
    "status": "ACTIVE|COMPLETED",
    "startedAt": "ISO date", "completedAt": "ISO date|null",
    "totalScore": "number|null", "accuracy": "number|null",
    "percentile": "number|null", "userRank": "number|null",
    "timeSpentSeconds": "number|null", "riskRatio": "number|null"
  }
  ```

---

### GET `/attempts/:id/questions`
- **Guard:** `JwtAuthGuard` (owner only)
- **Response:** `200 OK`
- **Response body:** Snapshotted questions for this attempt's test. Returns `contentPayload` (mapped from `contentSnapshot`). **Correct answers are included** — client must handle display accordingly.

---

### POST `/attempts/:id/submit`
- **Guard:** `JwtAuthGuard` (owner only)
- **Response:** `201 Created`
- **Request body:**
  ```json
  {
    "questionId": "string",
    "answer": "string",
    "timeSpentSeconds": "number (optional)",
    "visitationData": "any (optional)"
  }
  ```
- **Behaviour:** Upsert — submitting the same question twice updates the answer (last write wins). Concurrent submits for the same question are safe (no double-scoring).

---

### POST `/attempts/:id/submit-test`
- **Guard:** `JwtAuthGuard` (owner only)
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "id": "uuid", "status": "COMPLETED",
    "totalScore": "number", "accuracy": "number",
    "riskRatio": "number", "percentile": "number",
    "userRank": "number", "timeSpentSeconds": "number"
  }
  ```
- **Errors:** `400` — attempt already completed.
- **Atomicity:** Grading + all analytics writes (exam, subject, topic, trend, peer benchmark) are committed in a **single transaction**. If any part fails, nothing is persisted.
- **Concurrency:** Only the first `submit-test` call for a given attempt succeeds; subsequent concurrent calls are rejected.

---

## § 6 — Admin

All `/admin` endpoints require `JwtAuthGuard + RolesGuard + @Roles('admin')`.  
All actions are logged by `AuditLogInterceptor`.

---

### GET `/admin/analytics/system`
- **Response:** `200 OK`
- **Note:** `tests.draft` is computed as `total - published` (includes `ARCHIVED`).
- **Response body:**
  ```json
  {
    "users": { "total": 0, "active": 0, "inactive": 0 },
    "exams": { "total": 0 },
    "tests": { "total": 0, "published": 0, "draft": 0 },
    "attempts": { "total": 0, "completed": 0, "active": 0 }
  }
  ```

---

### GET `/admin/analytics/exam/:examId`
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "exam": { "id": "uuid", "name": "string", "isActive": true },
    "tests": 0,
    "threads": 0,
    "blueprints": 0,
    "activeSubscriptions": 0,
    "attempts": { "total": 0, "avgScore": 0, "avgAccuracy": 0, "avgTimeSeconds": 0 },
    "peerBenchmarks": [{ "blueprintVersion": 0, "totalParticipants": 0, "lastUpdated": "ISO date|null" }]
  }
  ```
- **Errors:** `404` — exam not found.
- **Note:** `peerBenchmarks[].lastUpdated` maps to the `lastRecalculatedAt` column in the database.

---

### GET `/admin/users`
- **Response:** `200 OK`
- **Query params:** `page (default 1)`, `limit (default 20)`, `role?`, `isActive?`, `search?`
- **Response body:**
  ```json
  {
    "users": [
      {
        "id": "uuid", "email": "string", "username": "string",
        "role": "LEARNER|ADMIN", "isActive": true, "isEmailVerified": false,
        "createdAt": "ISO date", "lastLogin": "ISO date|null",
        "_count": { "attempts": 0, "subscriptions": 0 }
      }
    ],
    "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 1 }
  }
  ```
- **Note:** `total` lives inside the `pagination` object, not at the top level.

---

### GET `/admin/users/:userId`
- **Response:** `200 OK`
- **Response body:** User object including `profile`, `subscriptions[]` (last 10, ordered by `startedAt desc`), `attempts[]` (last 10 COMPLETED, ordered by `completedAt desc`), and `_count.{attempts, sessions, authLogs}`.

---

### POST `/admin/users/:userId/suspend`
- **Response:** `200 OK`
- **Request body:** `{ "reason": "string (optional)" }`
- **Response body:** `{ "message": "User suspended successfully" }`
- **Errors:** `400` — target user is an ADMIN (admins cannot be suspended). `404` — user not found.
- **Side effects:** Sets `isActive = false`. Logs `ACCOUNT_SUSPENDED` audit event with optional reason. Does **not** flush sessions (use `PATCH /users/:id/suspend` for session flush).

---

### POST `/admin/users/:userId/activate`
- **Response:** `200 OK`
- **Response body:** `{ "message": "User activated successfully" }`
- **Errors:** `404` — user not found.

---

### DELETE `/admin/users/:userId`
- **Response:** `200 OK`
- **Response body:** `{ "message": "User data deleted successfully" }`
- **Errors:** `400` — target user is an ADMIN (admins cannot be deleted). `404` — user not found.
- **Behaviour:** Permanent GDPR cascade deletion. All related records (sessions, attempts, subscriptions, analytics) are removed via DB cascade constraints.

---

### GET `/admin/audit-logs`
- **Response:** `200 OK`
- **Query params:** `page`, `limit`, `userId?`, `event?`, `startDate?`, `endDate?`
- **Response body:** `{ "logs": [...], "pagination": {...} }`

---

### GET `/admin/tests/statistics`
- **Response:** `200 OK`
- **Query params:** `examId?`
- **Response body:**
  ```json
  {
    "summary": {
      "total": 0,
      "byStatus": { "DRAFT": 0, "PUBLISHED": 0, "ARCHIVED": 0 },
      "byDifficulty": { "EASY": 0, "MEDIUM": 0, "HARD": 0, "MIXED": 0 },
      "totalAttempts": 0
    },
    "tests": [
      {
        "id": "uuid", "status": "string", "difficulty": "string",
        "totalQuestions": 0, "totalMarks": 0,
        "exam": { "id": "uuid", "name": "string" },
        "_count": { "attempts": 0 }
      }
    ]
  }
  ```

---

### GET `/admin/tests/:testId/performance`
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "test": {
      "id": "uuid", "examId": "uuid", "versionNumber": "number",
      "durationSeconds": "number", "totalQuestions": "number",
      "totalMarks": "number", "status": "DRAFT|PUBLISHED|ARCHIVED",
      "exam": { "id": "uuid", "name": "string" }
    },
    "attempts": 0,
    "stats": {
      "score": { "avg": 0, "min": 0, "max": 0 },
      "accuracy": { "avg": 0, "min": 0, "max": 0 },
      "avgTimeSeconds": 0
    }
  }
  ```
- **Note:** `stats` is `null` when `attempts === 0`. `attempts` counts only `COMPLETED` attempts.
- **Errors:** `404` — test not found.

---

### PATCH `/admin/tests/:testId/visibility`
- **Response:** `200 OK`
- **Request body:** `{ "status": "PUBLISHED" | "ARCHIVED" }`
- **Response body:** Updated test.

---

### GET `/`
- **Response:** `200 OK`
- **Description:** Root welcome endpoint.

### GET `/health`
- **Response:** `200 OK`
- **Description:** Basic system health check.

---

## § 7 — Analytics (User-Scoped)

All `/analytics` endpoints require `JwtAuthGuard`. Data is scoped to the calling user.

---

### GET `/analytics/exam/:examId`
- **Response:** `200 OK`
- **Response body (with data):**
  ```json
  {
    "exam": { "id": "uuid", "name": "string", "isActive": true },
    "overallAccuracy": "number",
    "averageScore": "number",
    "riskRatio": "number",
    "riskClassification": "string|null",
    "inefficiencyIndex": "number",
    "totalAttempts": "number",
    "bestRank": "number|null",
    "currentStreak": "number",
    "lastAttemptAt": "ISO date|null",
    "averageTimePerQuestion": "number",
    "weakestSubject": "string|null",
    "updatedAt": "ISO date",
    "riskRatio": "number",
    "riskClassification": "Very Aggressive|Aggressive|Balanced|Cautious",
    "inefficiencyIndex": "number"
  }
  ```
  Returns just `{ "exam": {...} }` if no attempts recorded yet.
- **Errors:** `404` — exam not found.

---

### GET `/analytics/exam/:examId/subjects`
- **Response:** `200 OK`
- **Response body (per entry):**
  ```json
  {
    "id": "uuid", "userId": "uuid", "examId": "uuid",
    "subject": "string", "accuracy": "number",
    "attempts": "number", "averageTime": "number",
    "trendDelta": "number", "consistencyScore": "number",
    "lastTestedAt": "ISO date|null"
  }
  ```
  Ordered by `accuracy desc`.

---

### GET `/analytics/exam/:examId/topics`
- **Response:** `200 OK`
- **Response body (per entry):**
  ```json
  {
    "id": "uuid", "userId": "uuid", "examId": "uuid",
    "subject": "string", "topic": "string",
    "accuracy": "number", "attempts": "number",
    "averageTime": "number", "negativeRate": "number",
    "easyAccuracy": "number", "mediumAccuracy": "number", "hardAccuracy": "number",
    "consistencyScore": "number", "trendDelta": "number",
    "lastTestedAt": "ISO date|null",
    "healthStatus": "STABLE|IMPROVING|VOLATILE|WEAK"
  }
  ```
  Ordered by `accuracy desc`.

---

### GET `/analytics/exam/:examId/trend`
- **Response:** `200 OK`
- **Response body (per entry):**
  ```json
  {
    "id": "uuid",
    "attemptId": "uuid|null",
    "testDate": "ISO date",
    "score": "number",
    "accuracy": "number",
    "percentile": "number"
  }
  ```

---

### GET `/analytics/exam/:examId/benchmark`
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "userScore": "number",
    "benchmark": {
      "id": "uuid",
      "examId": "uuid",
      "blueprintVersion": "number|null",
      "percentileBands": { "99": 0, "95": 0, "90": 0, "80": 0, "50": 0 },
      "subjectAverages": { "Physics": 0, "Chemistry": 0, "Math": 0 },
      "scoreDistribution": { "0-10": 0, "10-20": 0, ... },
      "totalParticipants": 0,
      "computedAt": "ISO date",
      "lastRecalculatedAt": "ISO date|null"
    }
  }
  ```
  Ordered by `testDate asc`.

---

### GET `/analytics/exam/:examId/benchmark`
- **Response:** `200 OK`
- **Response body:**
  ```json
  {
    "userScore": "number|null",
    "benchmark": {
      "id": "uuid",
      "examId": "uuid",
      "blueprintVersion": "number|null",
      "percentileBands": "object",
      "subjectAverages": "object",
      "scoreDistribution": "object",
      "totalParticipants": "number",
      "computedAt": "ISO date",
      "lastRecalculatedAt": "ISO date|null"
    }
  }
  ```
- **Note:** `userScore` is the user's `averageScore` from `UserExamAnalytics`. `benchmark` is `null` if no peer data has been computed yet for this exam.

---

## § 8 — Data Integrity & Constraints

### Transaction Atomicity
After `POST /attempts/:id/submit-test` completes:
- The response **must** contain all grading fields: `totalScore`, `accuracy`, `riskRatio`, `percentile`, `userRank`.
- Analytics records (`userExamAnalytics`, `userSubjectAnalytics`, `userTopicAnalytics`, `performanceTrend`, `peerBenchmark`) are committed in the **same transaction**.
- An immediate `GET /analytics/exam/:examId` after grading **must** return populated data.
- Attempt status must be `COMPLETED` — a partial failure rolls back everything; the attempt never lands in an intermediate state.

### Concurrency Safety
| Scenario | Expected Behaviour |
|---|---|
| 3 concurrent `POST /auth/refresh` with same token | Exactly **1** succeeds, others get `401` |
| 4 concurrent `POST /attempts/:testId/start` | All succeed but return the **same attempt ID** (idempotent; serializable tx) |
| 3 concurrent `POST /attempts/:id/submit` for same question | At least 1 succeeds; answer is upserted — no double-scoring |
| 3 concurrent `POST /attempts/:id/submit-test` | Exactly **1** succeeds with `200`; others get `400` |

### Blueprint Effective Window
- `GET /exams/:id/blueprints/active` always returns a **single object** (never an array).
- Activating a blueprint with an overlapping window either:
  - Automatically closes the previous blueprint (`effectiveTo = now`), **or**
  - Is rejected with `400/409`.
- Future-dated blueprints (e.g., `effectiveFrom: 2030`) are created and stored but do not affect the current active result.

### Question Immutability
- No `PATCH` endpoint exists for canonical questions.
- Same `questionId` + `version` → `409`.
- `DELETE /questions/:questionId` → `400` if any `TestQuestion` snapshot references it.
- `TestQuestion` snapshots store `contentPayload` at injection time — changes to the canonical question do not retroactively affect existing tests.

### Subscription Gating
| Test Origin | Subscription Required? | Notes |
|---|---|---|
| `SYSTEM` | Yes | Admins always exempt |
| `GENERATED` | No | Any authenticated user |

- No active subscription → `403` (or `402`).
- Cancelled or expired subscription → `403`.
- Admin-granted access (`ADMIN_OVERRIDE`) is treated as a valid active subscription.

### General Referential Constraints
| Delete target | Blocked if… |
|---|---|
| Exam | Tests exist on exam |
| Blueprint | Tests reference `blueprintReferenceId` |
| Question | `TestQuestion` snapshot exists |
| Test | Completed attempts exist |
| Subscription | Can only be cancelled, not deleted, if ACTIVE |

---

*Last updated: 1 March 2026 — finalized after full system scan and integrity audit (controllers, services, DTOs, Prisma schema).*
