# Live mode — database contract

The browser (`src/lib/liveBackend.ts`) talks to Supabase **only** through the RPC functions below, using the public
anon key. All tables have row-level security enabled and **no** policies that allow `anon`/`authenticated` to read or
write tables directly. Every function is `SECURITY DEFINER`, `SET search_path = public, extensions, pg_temp`,
`REVOKE ALL ... FROM PUBLIC`, and `GRANT EXECUTE` only as listed. Errors are raised as
`RAISE EXCEPTION '<code>'` using exactly the codes in `shared/rules.ts` (`RuleError`), e.g. `project_full`.

Rules are the constants in `shared/rules.ts` (stored in `public.settings` so the instructor can change them).

## Identity

* Students: the browser calls `supabase.auth.signInAnonymously()`, then `redeem_access_code(student_id, code)`.
  This binds `auth.uid()` to the student in `student_sessions`. A typed name is never used as identity.
* Instructor: Supabase email sign-in (magic link). `is_instructor()` is true only when the JWT email is in
  `public.instructors` and the JWT is not anonymous (`(auth.jwt()->>'is_anonymous')::boolean` is not true).

## Tables

| table | purpose |
|---|---|
| `settings` (single row, id = 1) | `max_comments_per_project int 4`, `max_reviews_per_reviewer int 4`, `feedback_open bool true`, `reservation_minutes int 20`, `min_seconds_between_writes int 15`, `max_writes_per_hour int 20` |
| `students` | `id text pk`, `section text`, `section_code text`, `first_name`, `last_name`, `full_name`, `project_url text null`, `url_status text check in ('valid','missing','invalid')`, `active bool` |
| `access_codes` | `student_id pk → students`, `code_hash text` (bcrypt `$2a$`/`$2b$`, verified with pgcrypto `crypt`), `created_at`, `revoked_at`, `failed_attempts int`, `locked_until timestamptz` |
| `student_sessions` | `auth_uid uuid pk`, `student_id → students`, `created_at` (one student may have several devices) |
| `comments` | `id uuid pk`, `project_id → students`, `reviewer_id → students`, `reviewer_name text` (copied from roster), `pronouns text null`, `enjoyed text`, `suggestion text`, `status text ('published','removed')`, `removed_reason`, `removed_at`, `created_at`, `updated_at`; `UNIQUE (project_id, reviewer_id)`; `CHECK (project_id <> reviewer_id)` |
| `reservations` | `reviewer_id pk → students`, `project_id`, `expires_at` |
| `write_events` | `student_id`, `kind`, `at` (rate limiting) |
| `instructors` | `email text pk` |
| `audit_log` | `at`, `actor`, `action`, `detail jsonb` (instructor actions) |

Access codes are never stored in plaintext and are never returned by any function.

## Functions

| function | grant | returns | behaviour |
|---|---|---|---|
| `get_project_counts()` | anon, authenticated | `table(project_id text, published int)` | published comment counts for every active student (numbers only, no text) |
| `redeem_access_code(p_student_id text, p_code text)` | authenticated | `table(student_id text, full_name text)` | requires `auth.uid()`; `locked` if `locked_until > now()`; on mismatch increments `failed_attempts`, after 5 failures sets `locked_until = now() + 15 min` and raises `bad_code` (or `locked` once locked); unknown/revoked student → `bad_code` (same message, no enumeration); on success resets counters and upserts `student_sessions(auth.uid(), student_id)` |
| `whoami()` | authenticated | `table(student_id text, full_name text, section text, reviews_written int)` | zero rows if not bound |
| `sign_out_student()` | authenticated | void | deletes this `auth.uid()` binding |
| `get_comments(p_project_id text)` | authenticated | `table(id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text, suggestion text, created_at timestamptz, updated_at timestamptz)` | published only; caller must be a bound student or instructor, else `not_signed_in` |
| `my_reviews()` | authenticated | same columns as `get_comments` | the caller's own comments (published) |
| `submit_comment(p_project_id text, p_pronouns text, p_enjoyed text, p_suggestion text)` | authenticated | the new row (same columns as `get_comments`) | in order: bound student (`not_signed_in`); `feedback_open` (`closed`); project active + `url_status='valid'` (`project_unavailable`); not self (`self_review`); text rules from `shared/rules.ts` incl. blocked terms (`invalid_text` / `inappropriate`); rate limit (`rate_limited`); **lock the project's `students` row `FOR UPDATE`**, then: existing row by this reviewer for this project (`already_reviewed`), reviewer's published count ≥ max (`reviewer_limit`), project published count ≥ max (`project_full`); insert; delete the reviewer's reservation; log write_event |
| `update_comment(p_comment_id uuid, p_pronouns text, p_enjoyed text, p_suggestion text)` | authenticated | updated row | caller must be the bound reviewer of a published comment (`not_author` / `not_found`); same text + rate rules; never changes `project_id`, `reviewer_id` or `reviewer_name`; sets `updated_at` |
| `recommend_project()` | authenticated | `table(project_id text)` (0 or 1 row) | eligible = active, `url_status='valid'`, not self, not already reviewed by caller (any status), published < max. Score = published + active reservations by *other* reviewers. Order: score asc, then prefer the section whose eligible projects have the lower mean published count, then a stable pseudo-random tiebreak `md5(caller_id || project_id)`. Upserts the caller's reservation (`reservation_minutes`). Raises `reviewer_limit` if the caller is at the cap. |
| `is_instructor()` | authenticated | boolean | |
| `admin_overview()` | authenticated (checks `is_instructor()` → `not_instructor`) | jsonb `{settings, students:[{id, full_name, section, url_status, published_received, written}], comments:[{id, project_id, reviewer_id, reviewer_name, pronouns, enjoyed, suggestion, status, removed_reason, created_at, updated_at}]}` | everything the dashboard needs, including removed comments |
| `admin_remove_comment(p_comment_id uuid, p_reason text)` | authenticated (instructor) | void | status → removed (frees the slot), audit log |
| `admin_restore_comment(p_comment_id uuid)` | authenticated (instructor) | void | back to published **only if** the project is still below capacity (`project_full` otherwise), audit log |
| `admin_set_open(p_open boolean)` | authenticated (instructor) | void | |

`anon` gets EXECUTE only on `get_project_counts`. Nothing is granted on tables to `anon` or `authenticated`.
