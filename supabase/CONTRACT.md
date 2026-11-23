# Live mode — database contract (v2: two courses, assigned reviews)

The browser (`src/lib/liveBackend.ts`) talks to Supabase **only** through the RPC functions below, using the public
anon key. Every table has row-level security enabled and **no** policies, and all table/sequence privileges are revoked
from `anon` and `authenticated`. Every function is `SECURITY DEFINER`, `SET search_path = public, extensions, pg_temp`,
has `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated`, and is then granted only as listed.
Rule errors are raised as `RAISE EXCEPTION '<code>'` with exactly the codes in `shared/rules.ts` (`RuleError`).

## Concepts

* **Two review pools**: `course = '1101'` (MKTG 1101) and `course = '2241'` (MKTG 2241, sections `01` + `02`
  combined). A student may only *submit* reviews for projects in their own course. Reading is not restricted by
  course.
* **Eligible project**: `students.active and not hidden and url_status = 'valid' and link_status = 'working'`.
* **Assignments**: the instructor generates a plan per course (computed in the dashboard by `shared/allocation.ts`,
  re-validated here). A student may submit only for a project with a `pending` assignment to them — unless
  `settings.allow_extra_reviews` is on, the student has already completed `reviews_per_student`, and the project has
  room beyond what is still assigned to others (`published + pending assignments < capacity`).
* **Capacity**: `project_slots.capacity` (≥ `settings.base_slots`, default 4). A project never has more published
  comments than its capacity, even under concurrent submissions.
* **Identity**: students sign in anonymously (`supabase.auth.signInAnonymously()`), then `redeem_access_code(code)`
  binds `auth.uid()` to the student who owns that code. A typed name is never used. Codes are random
  `XXXX-XXXX-XXXX` (alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, ≈59 bits) stored only as
  `encode(sha256(convert_to(<normalised code>, 'UTF8')), 'hex')` — a fast hash is appropriate for long random tokens
  (not user-chosen passwords) and allows code-only sign-in. Normalised = upper-case, every character outside
  `[A-Z0-9]` removed, then re-dashed as `XXXX-XXXX-XXXX` when exactly 12 characters remain.
* **Instructor**: Supabase e-mail magic link (PKCE). `is_instructor()` is true only when the JWT is not anonymous and
  its e-mail is in `public.instructors`.

## Tables

| table | columns |
|---|---|
| `settings` (one row, id = 1) | `base_slots int 4`, `reviews_per_student int 4`, `feedback_open bool true`, `allow_extra_reviews bool false`, `min_seconds_between_writes int 15`, `max_writes_per_hour int 20`, `max_failed_codes_per_session int 10` (per 15 min), `max_failed_codes_global int 300` (per 15 min) |
| `students` | `id text pk`, `course text check in ('1101','2241')`, `section text check in ('pm','01','02')`, `section_code text`, `first_name`, `last_name`, `full_name`, `project_url text null`, `url_status text check in ('valid','missing','invalid')`, `link_status text check in ('working','broken','unchecked') default 'unchecked'`, `active bool true` (on the roster), `participating bool true` (instructor can release a non-participant), `hidden bool false` |
| `access_codes` | `student_id text pk → students`, `code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$')`, `created_at`, `revoked_at null` |
| `code_attempts` | `id bigint identity pk`, `auth_uid uuid`, `ok bool`, `at timestamptz default now()` (index on `(auth_uid, at)` and `(at)`) |
| `student_sessions` | `auth_uid uuid pk`, `student_id → students`, `created_at` |
| `project_slots` | `project_id text pk → students`, `capacity int not null check (capacity >= 0)`, `updated_at` |
| `assignments` | `id uuid pk`, `course text`, `reviewer_id → students`, `project_id → students`, `status text check in ('pending','completed','released')`, `comment_id uuid null`, `created_at`, `updated_at`; `unique (reviewer_id, project_id)`; `check (reviewer_id <> project_id)` |
| `comments` | `id uuid pk`, `course text`, `project_id → students`, `reviewer_id → students`, `reviewer_name text` (copied from the roster), `pronouns null`, `enjoyed`, `suggestion`, `status text check in ('published','removed')`, `removed_reason`, `removed_at`, `extra bool false` (an unassigned review the instructor allowed), `created_at`, `updated_at`; `unique (project_id, reviewer_id)`; `check (project_id <> reviewer_id)` |
| `write_events` | `student_id`, `kind`, `at` (rate limiting) |
| `instructors` | `email text pk` |
| `audit_log` | `at`, `actor`, `action`, `detail jsonb` |
| `blocked_terms` | mirrors `BLOCKED_TERMS` in `shared/rules.ts` |

## Student functions

| function | grant | returns | behaviour |
|---|---|---|---|
| `get_public_status()` | anon, authenticated | `table(project_id text, course text, published int, capacity int)` | one row per active, eligible project; numbers only. `capacity` = `project_slots.capacity` or `base_slots` when no row |
| `get_feedback_open()` | anon, authenticated | boolean | |
| `get_public_settings()` | anon, authenticated | `table(feedback_open boolean, allow_extra_reviews boolean)` | one row; lets the page show why a button is off |
| `redeem_access_code(p_code text)` | authenticated | `table(ok boolean, error text, student_id text, full_name text)` | **never raises for a wrong code** (so the attempt row is kept): requires `auth.uid()` (`not_signed_in` raised otherwise). If this `auth.uid()` has ≥ `max_failed_codes_per_session` failed attempts in the last 15 min, or all sessions together have ≥ `max_failed_codes_global`, returns `(false,'rate_limited',null,null)` without checking. Looks up `sha256` of the normalised code among non-revoked codes of active students; miss → inserts a failed attempt, returns `(false,'bad_code',null,null)`. Hit → inserts an ok attempt, upserts `student_sessions(auth.uid(), student_id)`, returns `(true,null,id,full_name)`. |
| `whoami()` | authenticated | `table(student_id, full_name, first_name, last_name, course, section_code, reviews_completed int, reviews_required int, participating bool)` | zero rows if not bound. `reviews_completed` = caller's published comments |
| `sign_out_student()` | authenticated | void | deletes this `auth.uid()` binding |
| `my_quest()` | authenticated | `table(project_id text, status text, comment_id uuid, published int, capacity int)` | the caller's `pending` and `completed` assignments plus their extra reviews (`status = 'extra'`), ordered completed first then by `md5(caller || project)`; `not_signed_in` if unbound |
| `next_review()` | authenticated | `table(project_id text)` (0 or 1 row) | the caller's pending assignment whose project has the lowest `published::numeric / capacity`, tie → `md5(caller || project)`; `not_signed_in` if unbound |
| `get_comments(p_project_id text)` | authenticated | `table(id uuid, project_id, reviewer_id, reviewer_name, pronouns, enjoyed, suggestion, created_at, updated_at)` | published only; caller must be a bound student or instructor (`not_signed_in`) |
| `my_reviews()` | authenticated | same columns | caller's published comments |
| `submit_comment(p_project_id text, p_pronouns text, p_enjoyed text, p_suggestion text)` | authenticated | the new row (same columns) | checks **in this order**: bound (`not_signed_in`); `feedback_open` (`closed`); project eligible (`project_unavailable`); not self (`self_review`); same course as caller (`wrong_course`); text rules (`invalid_text` / `inappropriate`); **lock both students rows `FOR UPDATE` in id order (`least`, then `greatest`)**; rate limit (`rate_limited`); any existing comment by caller on project (`already_reviewed`); a `pending` assignment (caller, project) → allowed; otherwise allowed as extra only if `allow_extra_reviews` and caller's published ≥ `reviews_per_student` and `published + other reviewers' pending assignments on the project < capacity`, else `not_assigned`; finally `published ≥ capacity` → `project_full`. Insert (reviewer name copied from `students.full_name`), mark the assignment `completed` with `comment_id`, log a write event |
| `update_comment(p_comment_id uuid, p_pronouns, p_enjoyed, p_suggestion)` | authenticated | updated row | `not_signed_in` / `not_found` / `not_author` / `closed` / text rules / lock the caller's students row / `rate_limited`; never changes project, reviewer or name |
| `is_instructor()` | authenticated | boolean | |

## Instructor functions (all raise `not_instructor` unless `is_instructor()`)

| function | returns | behaviour |
|---|---|---|
| `admin_overview()` | jsonb `{settings, students:[{id, course, section, section_code, full_name, url_status, link_status, active, participating, hidden, eligible, capacity, published_received, written}], assignments:[{reviewer_id, project_id, course, status}], comments:[{id, course, project_id, reviewer_id, reviewer_name, pronouns, enjoyed, suggestion, status, extra, removed_reason, created_at, updated_at}]}` | |
| `admin_apply_assignments(p_course text, p_capacities jsonb, p_assignments jsonb)` | `table(inserted int, released int, kept int)` | `p_capacities` = `{project_id: n}`; `p_assignments` = `[{reviewer_id, project_id}]` — the **complete desired set of pending assignments** for the course. Takes `pg_advisory_xact_lock(hashtext('fic.assign.'||p_course))` and locks every students row of the course `FOR UPDATE` in id order. Validates (raise `invalid_plan: <reason>`): course is `1101`/`2241`; every reviewer active + participating + in course; every project eligible + in course; no self pairs; no duplicate pairs; no pair that already has a comment; every capacity ≥ `base_slots` and ≥ published; per reviewer: published + planned ≤ `reviews_per_student`; per project: published + planned ≤ capacity. Then: upsert capacities for the listed projects; current `pending` rows not in the set → `released`; set rows already present (any status other than completed) → `pending`; new pairs inserted. Audit log. |
| `admin_set_participating(p_student_id text, p_participating boolean)` | void | false → their `pending` assignments become `released`. Audit log |
| `admin_remove_comment(p_comment_id uuid, p_reason text)` | void | status → removed (slot freed); its assignment → `released`. Audit log |
| `admin_restore_comment(p_comment_id uuid)` | void | locks the project row; only if published < capacity (`project_full` otherwise); assignment → `completed`. Audit log |
| `admin_set_open(p_open boolean)` | void | pause / reopen all submissions and edits |
| `admin_set_allow_extra(p_allow boolean)` | void | |

`anon` gets EXECUTE only on `get_public_status`, `get_feedback_open` and `get_public_settings`. Nothing is granted on tables.

## Roster upload

`npm run live-sql` turns `private/roster_full.json` (written by `npm run import-roster`, link status from
`npm run audit-links`) into `supabase/seed/roster_upsert.sql`: upsert of every student (keeps `participating`), and
`active = false` for ids no longer on the roster. `npm run access-codes` writes `private/access_codes_<date>.csv` (the
codes, to hand out) and `private/access_codes_upsert.sql` (hashes only).
