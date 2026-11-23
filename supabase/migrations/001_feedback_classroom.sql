-- =====================================================================================================================
--  The Feedback Classroom — Live-mode database (Supabase / Postgres 15+)
--  Migration 001, contract v2 (two courses, assigned reviews) — see supabase/CONTRACT.md
--
--  HOW TO USE (instructor)
--  -----------------------
--  1. Open your Supabase project → SQL Editor → New query.
--  2. Paste this WHOLE file and press "Run". It is safe to run again later: it only creates what is missing and
--     replaces the functions with the versions in this file. It never deletes students or comments.
--  3. Continue with supabase/SETUP.md (instructor e-mail, roster, access codes).
--
--  WHAT THIS FILE GUARANTEES
--  -------------------------
--  * The browser only ever holds the public "anon" key. With that key nobody can read or write any table directly:
--    every table has row-level security switched on, there are NO policies, and all table privileges are revoked
--    from the `anon` and `authenticated` roles.
--  * Everything the app does goes through the functions below (Supabase calls them "RPC"). Each one checks who is
--    calling (auth.uid() / auth.jwt()), enforces the rules from shared/rules.ts, and raises one of the short error
--    codes the app understands (e.g. 'project_full').
--  * Access codes are stored only as SHA-256 hashes and no function ever returns them.
--  * A project never gets more published comments than its capacity, even when many students press "Send" at the
--    same moment: submit_comment locks the two students rows involved before counting, and the instructor's
--    "apply assignments" locks every students row of the course.
--
--  The rule numbers live in the one-row table public.settings, so you can change them without editing code, e.g.
--      update public.settings set feedback_open = false where id = 1;
--  (or use the pause switch on the instructor dashboard).
-- =====================================================================================================================

create schema if not exists extensions;


-- =====================================================================================================================
--  UPGRADE FROM THE FIRST VERSION (v1 was never used with real students). These objects no longer exist in v2.
--  Each line does nothing on a fresh database or on a database that already has v2.
-- =====================================================================================================================
drop schema   if exists feedback_private cascade;                   -- v1 failed-attempt sequences + status view
drop function if exists public._ac_sync() cascade;                  -- also drops the v1 trigger on access_codes
drop function if exists public._ac_state_get(text);
drop function if exists public._ac_state_set(text, int, timestamptz);
drop function if exists public._ac_seq(text);
drop function if exists public.recommend_project();
drop function if exists public.get_project_counts();
drop function if exists public.redeem_access_code(text, text);      -- v1 took (student_id, code); v2 takes the code only
drop function if exists public.whoami();                            -- result columns changed in v2 (re-created below)
drop table    if exists public.reservations;


-- =====================================================================================================================
--  TABLES
-- =====================================================================================================================

-- One row (id = 1) of rule settings. Defaults are the constants in shared/rules.ts.
create table if not exists public.settings (
  id int primary key default 1 check (id = 1)
);
alter table public.settings add column if not exists base_slots                   int  not null default 4   check (base_slots >= 0);
alter table public.settings add column if not exists reviews_per_student          int  not null default 4   check (reviews_per_student >= 0);
alter table public.settings add column if not exists feedback_open                bool not null default true;
alter table public.settings add column if not exists allow_extra_reviews          bool not null default false;
alter table public.settings add column if not exists min_seconds_between_writes   int  not null default 15  check (min_seconds_between_writes >= 0);
alter table public.settings add column if not exists max_writes_per_hour          int  not null default 20  check (max_writes_per_hour >= 0);
alter table public.settings add column if not exists max_failed_codes_per_session int  not null default 10  check (max_failed_codes_per_session >= 0);
alter table public.settings add column if not exists max_failed_codes_global      int  not null default 300 check (max_failed_codes_global >= 0);
alter table public.settings drop column if exists max_comments_per_project;        -- v1 names
alter table public.settings drop column if exists max_reviews_per_reviewer;
alter table public.settings drop column if exists reservation_minutes;
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- The roster of both courses (uploaded with supabase/seed/roster_upsert.sql, generated by `npm run live-sql`).
-- Students are never deleted; a student who left is set active = false so comments stay linked.
create table if not exists public.students (
  id           text primary key,
  course       text not null,
  section      text not null,
  section_code text not null default '',
  first_name   text not null default '',
  last_name    text not null default '',
  full_name    text not null,
  project_url  text null,
  url_status   text not null,
  link_status  text not null default 'unchecked',
  active       bool not null default true,
  participating bool not null default true,
  hidden       bool not null default false
);
alter table public.students add column if not exists course text;
update public.students set course = '2241' where course is null;                    -- v1 held MKTG 2241 only
alter table public.students alter column course set not null;
alter table public.students add column if not exists link_status   text not null default 'unchecked';
alter table public.students add column if not exists participating bool not null default true;
alter table public.students add column if not exists hidden        bool not null default false;

-- One SHA-256 hash per student (uploaded with private/access_codes_upsert.sql from `npm run access-codes`).
create table if not exists public.access_codes (
  student_id text primary key references public.students (id),
  code_hash  text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);
-- v1 stored bcrypt hashes, which v2 cannot check. They are unusable, so they are removed (new codes must be issued).
alter table public.access_codes drop constraint if exists access_codes_code_hash_check;
delete from public.access_codes where code_hash !~ '^[0-9a-f]{64}$';
alter table public.access_codes drop column if exists failed_attempts;
alter table public.access_codes drop column if exists locked_until;

-- Every access-code try (for the per-browser and global throttles). A wrong code does not raise, so these rows stay.
create table if not exists public.code_attempts (
  id       bigint generated always as identity primary key,
  auth_uid uuid null,
  ok       bool not null,
  at       timestamptz not null default now()
);
create index if not exists code_attempts_uid_at_idx on public.code_attempts (auth_uid, at);
create index if not exists code_attempts_at_idx     on public.code_attempts (at);

-- Which signed-in browser (Supabase anonymous user id) belongs to which student. One student may use several devices.
create table if not exists public.student_sessions (
  auth_uid   uuid primary key,
  student_id text not null references public.students (id),
  created_at timestamptz not null default now()
);
create index if not exists student_sessions_student_idx on public.student_sessions (student_id);

-- Slot capacity per project (absent row = settings.base_slots). Written by admin_apply_assignments.
create table if not exists public.project_slots (
  project_id text primary key references public.students (id),
  capacity   int not null check (capacity >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.comments (
  id             uuid primary key default gen_random_uuid(),
  course         text not null,
  project_id     text not null references public.students (id),
  reviewer_id    text not null references public.students (id),
  reviewer_name  text not null,                -- copied from the roster at submission; never typed by the student
  pronouns       text null,
  enjoyed        text not null,
  suggestion     text not null,
  status         text not null default 'published',
  removed_reason text null,
  removed_at     timestamptz null,
  extra          bool not null default false,  -- an unassigned review the instructor allowed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.comments add column if not exists course text;
update public.comments c set course = s.course from public.students s where s.id = c.project_id and c.course is null;
alter table public.comments alter column course set not null;
alter table public.comments add column if not exists extra bool not null default false;
create index if not exists comments_project_status_idx  on public.comments (project_id, status);
create index if not exists comments_reviewer_status_idx on public.comments (reviewer_id, status);

-- Review assignments (the "Feedback Quest"), generated per course on the instructor dashboard.
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  course      text not null,
  reviewer_id text not null references public.students (id),
  project_id  text not null references public.students (id),
  status      text not null default 'pending',
  comment_id  uuid null references public.comments (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists assignments_project_status_idx  on public.assignments (project_id, status);
create index if not exists assignments_reviewer_status_idx on public.assignments (reviewer_id, status);
create index if not exists assignments_course_status_idx   on public.assignments (course, status);

-- Every successful write, for rate limiting.
create table if not exists public.write_events (
  id         bigint generated always as identity primary key,
  student_id text not null references public.students (id),
  kind       text not null,
  at         timestamptz not null default now()
);
create index if not exists write_events_student_at_idx on public.write_events (student_id, at);

-- E-mail addresses allowed to use the instructor dashboard (Supabase e-mail / magic-link sign-in).
create table if not exists public.instructors (
  email text primary key
);

-- Record of instructor actions.
create table if not exists public.audit_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);

-- Words that are never accepted in feedback. Mirrors BLOCKED_TERMS in shared/rules.ts (keep both in sync).
create table if not exists public.blocked_terms (
  term text primary key check (term = lower(term) and term <> '')
);
insert into public.blocked_terms (term) values
  ('fuck'), ('shit'), ('bitch'), ('asshole'), ('bastard'), ('dick'), ('cunt'), ('slut'), ('whore'), ('retard'),
  ('fag'), ('nigger'), ('nigga'), ('kill yourself'), ('kys'), ('stupid'), ('idiot'), ('dumb'), ('loser'), ('ugly'),
  ('sucks')
on conflict (term) do nothing;

-- Named constraints, added only when missing (so a re-run, or an upgraded v1 table, ends up identical).
do $$
declare r record;
begin
  for r in select * from (values
    ('students',      'students_course_check',         $c$check (course in ('1101', '2241'))$c$),
    ('students',      'students_section_check',        $c$check (section in ('pm', '01', '02'))$c$),
    ('students',      'students_course_section_check', $c$check ((course = '1101' and section = 'pm') or (course = '2241' and section in ('01', '02')))$c$),
    ('students',      'students_url_status_check',     $c$check (url_status in ('valid', 'missing', 'invalid'))$c$),
    ('students',      'students_link_status_check',    $c$check (link_status in ('working', 'broken', 'unchecked'))$c$),
    ('access_codes',  'access_codes_code_hash_sha256', $c$check (code_hash ~ '^[0-9a-f]{64}$')$c$),
    ('access_codes',  'access_codes_code_hash_key',    $c$unique (code_hash)$c$),
    ('comments',      'comments_status_check',         $c$check (status in ('published', 'removed'))$c$),
    ('comments',      'comments_course_check',         $c$check (course in ('1101', '2241'))$c$),
    ('comments',      'comments_one_per_pair',         $c$unique (project_id, reviewer_id)$c$),
    ('comments',      'comments_not_self',             $c$check (project_id <> reviewer_id)$c$),
    ('assignments',   'assignments_status_check',      $c$check (status in ('pending', 'completed', 'released'))$c$),
    ('assignments',   'assignments_course_check',      $c$check (course in ('1101', '2241'))$c$),
    ('assignments',   'assignments_one_per_pair',      $c$unique (reviewer_id, project_id)$c$),
    ('assignments',   'assignments_not_self',          $c$check (reviewer_id <> project_id)$c$)
  ) v(tbl, name, def) loop
    if not exists (select 1 from pg_constraint
                    where conrelid = format('public.%I', r.tbl)::regclass and conname = r.name) then
      execute format('alter table public.%I add constraint %I %s', r.tbl, r.name, r.def);
    end if;
  end loop;
end $$;


-- =====================================================================================================================
--  LOCK-DOWN: row-level security on, no policies, no table privileges for the browser roles.
--  (Supabase grants new tables to anon/authenticated by default — these revokes undo that.)
-- =====================================================================================================================
alter table public.settings         enable row level security;
alter table public.students         enable row level security;
alter table public.access_codes     enable row level security;
alter table public.code_attempts    enable row level security;
alter table public.student_sessions enable row level security;
alter table public.project_slots    enable row level security;
alter table public.assignments      enable row level security;
alter table public.comments         enable row level security;
alter table public.write_events     enable row level security;
alter table public.instructors      enable row level security;
alter table public.audit_log        enable row level security;
alter table public.blocked_terms    enable row level security;

-- No policies on these tables, ever: drop any that someone added by hand.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
            where schemaname = 'public'
              and tablename in ('settings', 'students', 'access_codes', 'code_attempts', 'student_sessions',
                                'project_slots', 'assignments', 'comments', 'write_events', 'instructors',
                                'audit_log', 'blocked_terms')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

revoke all on all tables    in schema public from public;
revoke all on all sequences in schema public from public;
do $$ begin
  execute 'revoke all on all tables    in schema public from anon, authenticated';
  execute 'revoke all on all sequences in schema public from anon, authenticated';
exception when undefined_object then null;   -- roles exist on Supabase; tolerate plain Postgres
end $$;


-- =====================================================================================================================
--  INTERNAL HELPERS (not callable from the browser)
-- =====================================================================================================================

-- Current settings row.
create or replace function public._settings()
returns public.settings
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select s from public.settings s where s.id = 1 $$;

-- The student bound to the caller's auth.uid() (null if none, or if that student is no longer active).
create or replace function public._current_student_id()
returns text
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select ss.student_id
    from public.student_sessions ss
    join public.students s on s.id = ss.student_id and s.active
   where ss.auth_uid = auth.uid()
$$;

-- A project that may receive reviews: on the roster, not hidden, a valid link that the link audit found working.
create or replace function public._eligible(p_project_id text)
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from public.students s
                  where s.id = p_project_id and s.active and not s.hidden
                    and s.url_status = 'valid' and s.link_status = 'working')
$$;

-- Published comments on a project.
create or replace function public._published(p_project_id text)
returns int
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select count(*)::int from public.comments c where c.project_id = p_project_id and c.status = 'published' $$;

-- Slot capacity of a project (project_slots, or settings.base_slots when there is no row).
create or replace function public._capacity(p_project_id text)
returns int
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select ps.capacity from public.project_slots ps where ps.project_id = p_project_id),
                  (select s.base_slots from public.settings s where s.id = 1))
$$;

-- Lock two students rows FOR UPDATE, always lower id first (every function that locks two rows uses this order,
-- and admin_apply_assignments locks a whole course in id order, so no two calls can deadlock).
create or replace function public._lock_pair(p_a text, p_b text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform 1 from public.students s where s.id = least(p_a, p_b)    for update;
  perform 1 from public.students s where s.id = greatest(p_a, p_b) for update;
end $$;

-- Mirrors normalizeAccessCode() in shared/accessCode.ts: JavaScript upper-case, drop everything outside A–Z / 0–9,
-- re-dash as XXXX-XXXX-XXXX when exactly 12 characters remain. The few non-ASCII characters whose JavaScript
-- upper-case contains ASCII letters (ß → SS, ﬁ → FI, ı → I, …) are mapped first; ASCII letters are upper-cased with
-- translate(), so the result does not depend on the database locale.
create or replace function public._normalize_access_code(p text)
returns text
language plpgsql immutable security definer
set search_path = public, extensions, pg_temp
as $$
declare v text := coalesce(p, '');
begin
  v := translate(v, U&'\0131\0149\017F\01F0\1E96\1E97\1E98\1E99\1E9A', 'INSJHTWYA');
  v := replace(replace(replace(replace(replace(replace(replace(replace(v,
         U&'\00DF', 'SS'), U&'\FB00', 'FF'), U&'\FB01', 'FI'), U&'\FB02', 'FL'),
         U&'\FB03', 'FFI'), U&'\FB04', 'FFL'), U&'\FB05', 'ST'), U&'\FB06', 'ST');
  v := translate(v, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  v := regexp_replace(v, '[^A-Z0-9]', '', 'g');
  if char_length(v) = 12 then v := substr(v, 1, 4) || '-' || substr(v, 5, 4) || '-' || substr(v, 9, 4); end if;
  return v;
end $$;

-- Mirrors hashAccessCode() in shared/accessCode.ts.
create or replace function public._access_code_hash(p text)
returns text
language sql immutable security definer
set search_path = public, extensions, pg_temp
as $$ select encode(sha256(convert_to(public._normalize_access_code(p), 'UTF8')), 'hex') $$;

-- Length as JavaScript counts it (UTF-16 code units): characters outside the Basic Multilingual Plane count twice.
create or replace function public._js_length(p text)
returns int
language sql immutable security definer
set search_path = public, extensions, pg_temp
as $$
  select char_length(p) + coalesce((select count(*)::int from regexp_matches(p, '[\U00010000-\U0010FFFF]', 'g')), 0)
$$;

-- Mirrors normalizeText() in shared/rules.ts:
--   CRLF/CR → LF; runs of space/tab/no-break-space → one space; 3+ newlines → 2; trim exactly what
--   JavaScript's String.prototype.trim() removes.
create or replace function public._normalize_text(p text)
returns text
language sql immutable security definer
set search_path = public, extensions, pg_temp
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p, ''), '\r\n?', E'\n', 'g'),
             '[ \t\u00a0]+', ' ', 'g'),
           '\n{3,}', E'\n\n', 'g'),
         '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
         '', 'g')
$$;

-- Mirrors findBlockedTerm() in shared/rules.ts: lower-case, every run of characters other than a-z 0-9 ' and space
-- becomes one space, then a term matches as a whole word, or with a plain "s" / "ed" suffix.
-- U+212A (Kelvin sign) lower-cases to "k" and U+0130 (dotted capital I) to "i" + U+0307 in JavaScript; they are
-- mapped explicitly so the result does not depend on the database locale. Returns the matched term or null.
create or replace function public._find_blocked_term(p text)
returns text
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  with t as (
    select ' ' || regexp_replace(lower(replace(translate(coalesce(p, ''), U&'\212A', 'k'), U&'\0130', U&'i\0307')),
                                 '[^a-z0-9'' ]+', ' ', 'g') || ' ' as s
  )
  select b.term
    from public.blocked_terms b, t
   where strpos(t.s, ' ' || b.term || ' ') > 0
      or strpos(t.s, ' ' || b.term || 's ') > 0
      or strpos(t.s, ' ' || b.term || 'ed ') > 0
   order by b.term
   limit 1
$$;

-- Mirrors validateFeedback() in shared/rules.ts (same order of checks). Raises 'invalid_text' or 'inappropriate';
-- otherwise returns the normalised values (pronouns null when empty).
create or replace function public._validate_feedback(p_pronouns text, p_enjoyed text, p_suggestion text,
                                                     out pronouns text, out enjoyed text, out suggestion text)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  pronouns   := public._normalize_text(p_pronouns);
  enjoyed    := public._normalize_text(p_enjoyed);
  suggestion := public._normalize_text(p_suggestion);
  if public._js_length(pronouns) > 40 then raise exception 'invalid_text'; end if;               -- PRONOUNS_MAX
  if public._js_length(enjoyed) < 15 or public._js_length(enjoyed) > 800 then                     -- TEXT_MIN/TEXT_MAX
    raise exception 'invalid_text';
  end if;
  if public._find_blocked_term(enjoyed) is not null then raise exception 'inappropriate'; end if;
  if public._js_length(suggestion) < 15 or public._js_length(suggestion) > 800 then
    raise exception 'invalid_text';
  end if;
  if public._find_blocked_term(suggestion) is not null then raise exception 'inappropriate'; end if;
  if public._find_blocked_term(pronouns) is not null then raise exception 'inappropriate'; end if;
  pronouns := nullif(pronouns, '');
end $$;

-- Rate limit: at least min_seconds_between_writes since this student's last write, and at most max_writes_per_hour.
create or replace function public._check_rate(p_student_id text)
returns void
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.settings := public._settings();
begin
  if v.min_seconds_between_writes > 0 and exists (select 1 from public.write_events w
              where w.student_id = p_student_id
                and w.at > now() - make_interval(secs => v.min_seconds_between_writes)) then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.write_events w
       where w.student_id = p_student_id and w.at > now() - interval '1 hour') >= v.max_writes_per_hour then
    raise exception 'rate_limited';
  end if;
end $$;

-- Instructor check; returns the instructor's (lower-case) e-mail for the audit log.
create or replace function public._require_instructor()
returns text
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_instructor() then raise exception 'not_instructor'; end if;
  return lower(auth.jwt() ->> 'email');
end $$;


-- =====================================================================================================================
--  STUDENT FUNCTIONS (called by the app)
-- =====================================================================================================================

-- Published count and capacity of every project that may receive reviews (numbers only). Works before signing in.
create or replace function public.get_public_status()
returns table (project_id text, course text, published int, capacity int)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select s.id, s.course, public._published(s.id), public._capacity(s.id)
    from public.students s
   where s.active and not s.hidden and s.url_status = 'valid' and s.link_status = 'working'
   order by s.id
$$;

create or replace function public.get_feedback_open()
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select s.feedback_open from public.settings s where s.id = 1 $$;

-- Public switches the site needs before sign-in (no personal data).
create or replace function public.get_public_settings()
returns table(feedback_open boolean, allow_extra_reviews boolean)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$ select s.feedback_open, s.allow_extra_reviews from public.settings s where s.id = 1 $$;

-- Is the caller a (non-anonymous) instructor?
create or replace function public.is_instructor()
returns boolean
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and auth.uid() is not null
     and coalesce(auth.jwt() ->> 'email', '') <> ''
     and exists (select 1 from public.instructors i where lower(i.email) = lower(auth.jwt() ->> 'email'))
$$;

-- Binds the caller's (anonymous) Supabase user to the student who owns this access code.
-- A wrong code RETURNS (false, 'bad_code') instead of raising, so the failed attempt row is kept.
create or replace function public.redeem_access_code(p_code text)
returns table (ok boolean, error text, student_id text, full_name text)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid  uuid := auth.uid();
  v_set  public.settings := public._settings();
  v_id   text;
  v_name text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  -- One attempt at a time per browser session, so parallel requests cannot slip past the per-session throttle.
  perform pg_advisory_xact_lock(hashtext('fic.redeem.' || v_uid::text));

  if (select count(*) from public.code_attempts a
       where a.auth_uid = v_uid and not a.ok and a.at > now() - interval '15 minutes') >= v_set.max_failed_codes_per_session
     or (select count(*) from public.code_attempts a
          where not a.ok and a.at > now() - interval '15 minutes') >= v_set.max_failed_codes_global then
    return query select false, 'rate_limited'::text, null::text, null::text;
    return;
  end if;

  select s.id, s.full_name into v_id, v_name
    from public.access_codes ac
    join public.students s on s.id = ac.student_id
   where ac.code_hash = public._access_code_hash(p_code) and ac.revoked_at is null and s.active;

  if v_id is null then
    insert into public.code_attempts (auth_uid, ok) values (v_uid, false);
    return query select false, 'bad_code'::text, null::text, null::text;
    return;
  end if;

  insert into public.code_attempts (auth_uid, ok) values (v_uid, true);
  insert into public.student_sessions (auth_uid, student_id) values (v_uid, v_id)
    on conflict (auth_uid) do update set student_id = excluded.student_id, created_at = now();
  return query select true, null::text, v_id, v_name;
end $$;

-- Who am I? Zero rows when this browser is not bound to a student.
create or replace function public.whoami()
returns table (student_id text, full_name text, first_name text, last_name text, course text, section_code text,
               reviews_completed int, reviews_required int, participating boolean)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select s.id, s.full_name, s.first_name, s.last_name, s.course, s.section_code,
         (select count(*)::int from public.comments c where c.reviewer_id = s.id and c.status = 'published'),
         (select st.reviews_per_student from public.settings st where st.id = 1),
         s.participating
    from public.students s
   where s.id = public._current_student_id()
$$;

-- Forget this browser's binding.
create or replace function public.sign_out_student()
returns void
language sql volatile security definer
set search_path = public, extensions, pg_temp
as $$ delete from public.student_sessions where auth_uid = auth.uid() $$;

-- The caller's Feedback Quest: pending + completed assignments, plus extra reviews (status 'extra').
create or replace function public.my_quest()
returns table (project_id text, status text, comment_id uuid, published int, capacity int)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare v_me text := public._current_student_id();
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  return query
    select x.pid, x.st, x.cid, public._published(x.pid), public._capacity(x.pid)
      from (select a.project_id as pid, a.status as st, a.comment_id as cid
              from public.assignments a
             where a.reviewer_id = v_me and a.status in ('pending', 'completed')
            union all
            select c.project_id, 'extra', c.id
              from public.comments c
             where c.reviewer_id = v_me and c.extra and c.status = 'published') x
     order by case x.st when 'completed' then 0 when 'extra' then 1 else 2 end, md5(v_me || x.pid);
end $$;

-- "Find My Next Review": the caller's pending assignment on the least-filled project (published / capacity),
-- ties broken by md5(caller || project). Only projects that can still receive the review are offered.
create or replace function public.next_review()
returns table (project_id text)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare v_me text := public._current_student_id();
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  return query
    select q.pid
      from (select a.project_id as pid, public._published(a.project_id) as pub, public._capacity(a.project_id) as cap
              from public.assignments a
             where a.reviewer_id = v_me and a.status = 'pending' and public._eligible(a.project_id)) q
     where q.pub < q.cap
     order by q.pub::numeric / q.cap, md5(v_me || q.pid)
     limit 1;
end $$;

-- Published comments on one project (any course). Bound students and instructors only.
create or replace function public.get_comments(p_project_id text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if public._current_student_id() is null and not public.is_instructor() then raise exception 'not_signed_in'; end if;
  return query
    select c.id, c.project_id, c.reviewer_id, c.reviewer_name, c.pronouns, c.enjoyed, c.suggestion, c.created_at, c.updated_at
      from public.comments c
     where c.project_id = p_project_id and c.status = 'published'
     order by c.created_at, c.id;
end $$;

-- The caller's own published comments.
create or replace function public.my_reviews()
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare v_me text := public._current_student_id();
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  return query
    select c.id, c.project_id, c.reviewer_id, c.reviewer_name, c.pronouns, c.enjoyed, c.suggestion, c.created_at, c.updated_at
      from public.comments c
     where c.reviewer_id = v_me and c.status = 'published'
     order by c.created_at, c.id;
end $$;

-- Leave feedback on a project. The checks run in the order supabase/CONTRACT.md lists.
create or replace function public.submit_comment(p_project_id text, p_pronouns text, p_enjoyed text, p_suggestion text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_me      text := public._current_student_id();
  v_set     public.settings := public._settings();
  v_course  text;
  v_name    text;
  v_txt     record;
  v_pub     int;
  v_cap     int;
  v_extra   bool := false;
  v_row     public.comments;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  if not v_set.feedback_open then raise exception 'closed'; end if;
  if not public._eligible(p_project_id) then raise exception 'project_unavailable'; end if;
  if p_project_id = v_me then raise exception 'self_review'; end if;
  select s.course, s.full_name into v_course, v_name from public.students s where s.id = v_me;
  if not exists (select 1 from public.students s where s.id = p_project_id and s.course = v_course) then
    raise exception 'wrong_course';
  end if;
  select * into v_txt from public._validate_feedback(p_pronouns, p_enjoyed, p_suggestion);

  -- Lock BOTH students rows (reviewer and project), lower id first. Every other submission touching the same
  -- project or the same reviewer — and every instructor plan for this course — waits here until this one commits,
  -- and everything below is then read fresh, so the capacity can never be exceeded by simultaneous submissions.
  perform public._lock_pair(v_me, p_project_id);
  if not public._eligible(p_project_id) then raise exception 'project_unavailable'; end if;   -- changed while waiting
  v_set := public._settings();

  perform public._check_rate(v_me);
  if exists (select 1 from public.comments c where c.project_id = p_project_id and c.reviewer_id = v_me) then
    raise exception 'already_reviewed';
  end if;

  v_pub := public._published(p_project_id);
  v_cap := public._capacity(p_project_id);
  if not exists (select 1 from public.assignments a
                  where a.reviewer_id = v_me and a.project_id = p_project_id and a.status = 'pending') then
    if v_set.allow_extra_reviews
       and (select count(*) from public.comments c where c.reviewer_id = v_me and c.status = 'published') >= v_set.reviews_per_student
       and v_pub + (select count(*) from public.assignments a
                     where a.project_id = p_project_id and a.status = 'pending' and a.reviewer_id <> v_me) < v_cap then
      v_extra := true;
    else
      raise exception 'not_assigned';
    end if;
  end if;
  if v_pub >= v_cap then raise exception 'project_full'; end if;

  insert into public.comments (course, project_id, reviewer_id, reviewer_name, pronouns, enjoyed, suggestion, extra)
  values (v_course, p_project_id, v_me, v_name, v_txt.pronouns, v_txt.enjoyed, v_txt.suggestion, v_extra)
  returning * into v_row;
  update public.assignments a
     set status = 'completed', comment_id = v_row.id, updated_at = now()
   where a.reviewer_id = v_me and a.project_id = p_project_id and a.status = 'pending';
  insert into public.write_events (student_id, kind) values (v_me, case when v_extra then 'submit_extra' else 'submit' end);

  return query select v_row.id, v_row.project_id, v_row.reviewer_id, v_row.reviewer_name, v_row.pronouns,
                      v_row.enjoyed, v_row.suggestion, v_row.created_at, v_row.updated_at;
end $$;

-- Edit your own published comment. Project, reviewer and reviewer name never change; no slot is used.
create or replace function public.update_comment(p_comment_id uuid, p_pronouns text, p_enjoyed text, p_suggestion text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_me  text := public._current_student_id();
  v_cur public.comments;
  v_txt record;
  v_row public.comments;
begin
  if v_me is null then raise exception 'not_signed_in'; end if;
  select * into v_cur from public.comments c where c.id = p_comment_id and c.status = 'published';
  if not found then raise exception 'not_found'; end if;
  if v_cur.reviewer_id <> v_me then raise exception 'not_author'; end if;
  if not (public._settings()).feedback_open then raise exception 'closed'; end if;
  select * into v_txt from public._validate_feedback(p_pronouns, p_enjoyed, p_suggestion);
  perform 1 from public.students s where s.id = v_me for update;   -- serialise this student's writes
  perform public._check_rate(v_me);
  -- Removed by the instructor while we waited? Then it is no longer editable.
  perform 1 from public.comments c where c.id = p_comment_id and c.status = 'published' for update;
  if not found then raise exception 'not_found'; end if;

  update public.comments c
     set pronouns = v_txt.pronouns, enjoyed = v_txt.enjoyed, suggestion = v_txt.suggestion, updated_at = now()
   where c.id = p_comment_id
  returning * into v_row;
  insert into public.write_events (student_id, kind) values (v_me, 'update');

  return query select v_row.id, v_row.project_id, v_row.reviewer_id, v_row.reviewer_name, v_row.pronouns,
                      v_row.enjoyed, v_row.suggestion, v_row.created_at, v_row.updated_at;
end $$;


-- =====================================================================================================================
--  INSTRUCTOR FUNCTIONS (caller must be signed in by e-mail with an address in public.instructors)
-- =====================================================================================================================

create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public._require_instructor();
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.settings s where s.id = 1),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'course', s.course, 'section', s.section, 'section_code', s.section_code,
               'full_name', s.full_name, 'url_status', s.url_status, 'link_status', s.link_status,
               'active', s.active, 'participating', s.participating, 'hidden', s.hidden,
               'eligible', public._eligible(s.id), 'capacity', public._capacity(s.id),
               'published_received', public._published(s.id),
               'written', (select count(*) from public.comments c where c.reviewer_id = s.id and c.status = 'published'))
             order by s.id)
        from public.students s), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('reviewer_id', a.reviewer_id, 'project_id', a.project_id,
                                          'course', a.course, 'status', a.status)
             order by a.course, a.reviewer_id, a.project_id)
        from public.assignments a), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'course', c.course, 'project_id', c.project_id, 'reviewer_id', c.reviewer_id,
               'reviewer_name', c.reviewer_name, 'pronouns', c.pronouns, 'enjoyed', c.enjoyed,
               'suggestion', c.suggestion, 'status', c.status, 'extra', c.extra, 'removed_reason', c.removed_reason,
               'created_at', c.created_at, 'updated_at', c.updated_at)
             order by c.created_at, c.id)
        from public.comments c), '[]'::jsonb));
end $$;

-- Replace the course's pending assignments with the plan computed on the dashboard (shared/allocation.ts), after
-- re-checking every rule here. Completed assignments are never touched.
create or replace function public.admin_apply_assignments(p_course text, p_capacities jsonb, p_assignments jsonb)
returns table (inserted int, released int, kept int)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    text := public._require_instructor();
  v_set      public.settings;
  v_caps     jsonb := coalesce(p_capacities, '{}'::jsonb);
  v_plan     jsonb := coalesce(p_assignments, '[]'::jsonb);
  v_r        text[];
  v_p        text[];
  v_bad      text;
  v_released int;
  v_kept     int;
  v_revived  int;
  v_new      int;
begin
  if p_course is null or p_course not in ('1101', '2241') then
    raise exception 'invalid_plan: unknown course "%"', coalesce(p_course, '');
  end if;

  -- Serialise against other plans for this course, then against every submission in the course (submit_comment
  -- locks the reviewer's and the project's students rows; both are in this course).
  perform pg_advisory_xact_lock(hashtext('fic.assign.' || p_course));
  perform 1 from public.students s where s.course = p_course order by s.id for update;
  v_set := public._settings();

  -- Shape of the inputs.
  if jsonb_typeof(v_caps) <> 'object' then raise exception 'invalid_plan: capacities must be an object'; end if;
  if jsonb_typeof(v_plan) <> 'array' then raise exception 'invalid_plan: assignments must be an array'; end if;
  select k into v_bad from jsonb_each(v_caps) e(k, v)
   where case when jsonb_typeof(e.v) <> 'number' then true
              else (e.v)::text::numeric <> trunc((e.v)::text::numeric)
                   or (e.v)::text::numeric < 0 or (e.v)::text::numeric > 100000 end
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: capacity of % is not a whole number', v_bad; end if;
  if exists (select 1 from jsonb_array_elements(v_plan) e
              where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'reviewer_id') is distinct from 'string'
                 or jsonb_typeof(e -> 'project_id') is distinct from 'string') then
    raise exception 'invalid_plan: every assignment needs a reviewer_id and a project_id';
  end if;
  select coalesce(array_agg(e ->> 'reviewer_id'), '{}'), coalesce(array_agg(e ->> 'project_id'), '{}')
    into v_r, v_p
    from jsonb_array_elements(v_plan) e;

  -- Reviewers: on the roster, participating, in this course.
  select x.r into v_bad from unnest(v_r) x(r)
   where not exists (select 1 from public.students s
                      where s.id = x.r and s.active and s.participating and s.course = p_course)
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: reviewer % is not an active participating student of %', v_bad, p_course; end if;
  -- Projects: eligible and in this course.
  select x.p into v_bad from unnest(v_p) x(p)
   where not public._eligible(x.p)
      or not exists (select 1 from public.students s where s.id = x.p and s.course = p_course)
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: project % is not eligible in %', v_bad, p_course; end if;
  -- No self reviews, no duplicates, nothing already reviewed.
  select x.r into v_bad from unnest(v_r, v_p) x(r, p) where x.r = x.p limit 1;
  if v_bad is not null then raise exception 'invalid_plan: self review %', v_bad; end if;
  select x.r || '>' || x.p into v_bad from unnest(v_r, v_p) x(r, p) group by x.r, x.p having count(*) > 1 limit 1;
  if v_bad is not null then raise exception 'invalid_plan: duplicate pair %', v_bad; end if;
  select x.r || '>' || x.p into v_bad from unnest(v_r, v_p) x(r, p)
   where exists (select 1 from public.comments c where c.reviewer_id = x.r and c.project_id = x.p)
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: % already has a comment', v_bad; end if;
  -- Capacities: projects of this course, at least base_slots, never below what is already published.
  select e.k into v_bad from jsonb_each(v_caps) e(k, v)
   where not exists (select 1 from public.students s where s.id = e.k and s.course = p_course)
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: capacity given for % which is not in %', v_bad, p_course; end if;
  select e.k into v_bad from jsonb_each(v_caps) e(k, v)
   where (e.v)::text::numeric::int < v_set.base_slots or (e.v)::text::numeric::int < public._published(e.k)
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: capacity of % is below % or below its published comments', v_bad, v_set.base_slots; end if;
  -- Per reviewer: published + planned ≤ reviews_per_student.
  select x.r into v_bad from unnest(v_r) x(r) group by x.r
   having count(*) + (select count(*) from public.comments c where c.reviewer_id = x.r and c.status = 'published')
          > v_set.reviews_per_student
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: reviewer % would have more than % reviews', v_bad, v_set.reviews_per_student; end if;
  -- Per project: published + planned ≤ capacity (the new capacity when one is given).
  select x.p into v_bad from unnest(v_p) x(p) group by x.p
   having count(*) + public._published(x.p)
          > coalesce((v_caps ->> x.p)::numeric::int, public._capacity(x.p))
   limit 1;
  if v_bad is not null then raise exception 'invalid_plan: project % would be over capacity', v_bad; end if;

  -- Apply.
  insert into public.project_slots (project_id, capacity, updated_at)
  select e.k, (e.v)::text::numeric::int, now() from jsonb_each(v_caps) e(k, v)
  on conflict (project_id) do update set capacity = excluded.capacity, updated_at = now();

  update public.assignments a set status = 'released', updated_at = now()
   where a.course = p_course and a.status = 'pending'
     and not exists (select 1 from unnest(v_r, v_p) x(r, p) where x.r = a.reviewer_id and x.p = a.project_id);
  get diagnostics v_released = row_count;

  select count(*) into v_kept from public.assignments a, unnest(v_r, v_p) x(r, p)
   where a.reviewer_id = x.r and a.project_id = x.p and a.status = 'pending';

  update public.assignments a set status = 'pending', course = p_course, updated_at = now()
    from unnest(v_r, v_p) x(r, p)
   where a.reviewer_id = x.r and a.project_id = x.p and a.status not in ('pending', 'completed');
  get diagnostics v_revived = row_count;

  insert into public.assignments (course, reviewer_id, project_id, status)
  select p_course, x.r, x.p, 'pending' from unnest(v_r, v_p) x(r, p)
  on conflict (reviewer_id, project_id) do nothing;
  get diagnostics v_new = row_count;

  insert into public.audit_log (actor, action, detail)
  values (v_actor, 'apply_assignments', jsonb_build_object('course', p_course, 'inserted', v_new + v_revived,
          'released', v_released, 'kept', v_kept, 'pending', coalesce(array_length(v_r, 1), 0),
          'capacities', v_caps));
  return query select v_new + v_revived, v_released, v_kept;
end $$;

-- Mark a student as (not) taking part. Not taking part releases their pending assignments.
create or replace function public.admin_set_participating(p_student_id text, p_participating boolean)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text := public._require_instructor(); v_released int := 0;
begin
  perform 1 from public.students s where s.id = p_student_id for update;   -- waits for their submissions / plans
  if not found then raise exception 'not_found'; end if;
  update public.students s set participating = coalesce(p_participating, false) where s.id = p_student_id;
  if not coalesce(p_participating, false) then
    update public.assignments a set status = 'released', updated_at = now()
     where a.reviewer_id = p_student_id and a.status = 'pending';
    get diagnostics v_released = row_count;
  end if;
  insert into public.audit_log (actor, action, detail)
  values (v_actor, 'set_participating', jsonb_build_object('student_id', p_student_id,
          'participating', coalesce(p_participating, false), 'released', v_released));
end $$;

-- Hide a comment (frees the slot on that project); its assignment is released.
create or replace function public.admin_remove_comment(p_comment_id uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text := public._require_instructor(); v_c public.comments;
begin
  select * into v_c from public.comments c where c.id = p_comment_id;
  if not found then raise exception 'not_found'; end if;
  perform public._lock_pair(v_c.reviewer_id, v_c.project_id);                -- same lock order as submit_comment
  update public.comments c
     set status = 'removed', removed_reason = nullif(btrim(coalesce(p_reason, '')), ''), removed_at = now()
   where c.id = p_comment_id;
  update public.assignments a set status = 'released', updated_at = now()
   where a.comment_id = p_comment_id and a.status = 'completed';
  insert into public.audit_log (actor, action, detail)
  values (v_actor, 'remove_comment', jsonb_build_object('comment_id', p_comment_id, 'project_id', v_c.project_id,
                                                        'reviewer_id', v_c.reviewer_id, 'reason', p_reason));
end $$;

-- Bring a removed comment back — only while the project is below capacity. Its assignment is completed again.
create or replace function public.admin_restore_comment(p_comment_id uuid)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text := public._require_instructor(); v_c public.comments;
begin
  select * into v_c from public.comments c where c.id = p_comment_id;
  if not found then raise exception 'not_found'; end if;
  perform public._lock_pair(v_c.reviewer_id, v_c.project_id);                -- locks the project row
  select * into v_c from public.comments c where c.id = p_comment_id for update;
  if v_c.status = 'published' then return; end if;
  if public._published(v_c.project_id) >= public._capacity(v_c.project_id) then raise exception 'project_full'; end if;
  update public.comments c set status = 'published', removed_reason = null, removed_at = null where c.id = p_comment_id;
  update public.assignments a set status = 'completed', updated_at = now() where a.comment_id = p_comment_id;
  insert into public.audit_log (actor, action, detail)
  values (v_actor, 'restore_comment', jsonb_build_object('comment_id', p_comment_id, 'project_id', v_c.project_id,
                                                         'reviewer_id', v_c.reviewer_id));
end $$;

-- Pause or reopen all submissions and edits.
create or replace function public.admin_set_open(p_open boolean)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text := public._require_instructor();
begin
  update public.settings set feedback_open = coalesce(p_open, false) where id = 1;
  insert into public.audit_log (actor, action, detail) values (v_actor, 'set_open', jsonb_build_object('open', coalesce(p_open, false)));
end $$;

-- Allow (or stop) extra reviews by students who finished their assigned ones.
create or replace function public.admin_set_allow_extra(p_allow boolean)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare v_actor text := public._require_instructor();
begin
  update public.settings set allow_extra_reviews = coalesce(p_allow, false) where id = 1;
  insert into public.audit_log (actor, action, detail) values (v_actor, 'set_allow_extra', jsonb_build_object('allow', coalesce(p_allow, false)));
end $$;


-- =====================================================================================================================
--  FUNCTION PRIVILEGES
--  Postgres lets everyone (PUBLIC) execute new functions, and Supabase additionally grants them to anon and
--  authenticated by default. Revoke all of that, then grant exactly what the app needs.
-- =====================================================================================================================
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('_settings', '_current_student_id', '_eligible', '_published', '_capacity', '_lock_pair',
                         '_normalize_access_code', '_access_code_hash', '_js_length', '_normalize_text',
                         '_find_blocked_term', '_validate_feedback', '_check_rate', '_require_instructor',
                         'get_public_status', 'get_feedback_open', 'get_public_settings', 'is_instructor', 'redeem_access_code', 'whoami',
                         'sign_out_student', 'my_quest', 'next_review', 'get_comments', 'my_reviews',
                         'submit_comment', 'update_comment', 'admin_overview', 'admin_apply_assignments',
                         'admin_set_participating', 'admin_remove_comment', 'admin_restore_comment',
                         'admin_set_open', 'admin_set_allow_extra')
  loop
    execute format('revoke all on function %s from public', f);
    begin
      execute format('revoke all on function %s from anon, authenticated', f);
    exception when undefined_object then null;   -- roles exist on Supabase; tolerate plain Postgres
    end;
  end loop;
end $$;

grant execute on function public.get_public_status()                              to anon, authenticated;
grant execute on function public.get_feedback_open()                              to anon, authenticated;
grant execute on function public.get_public_settings()                            to anon, authenticated;
grant execute on function public.redeem_access_code(text)                         to authenticated;
grant execute on function public.whoami()                                         to authenticated;
grant execute on function public.sign_out_student()                               to authenticated;
grant execute on function public.my_quest()                                       to authenticated;
grant execute on function public.next_review()                                    to authenticated;
grant execute on function public.get_comments(text)                               to authenticated;
grant execute on function public.my_reviews()                                     to authenticated;
grant execute on function public.submit_comment(text, text, text, text)           to authenticated;
grant execute on function public.update_comment(uuid, text, text, text)           to authenticated;
grant execute on function public.is_instructor()                                  to authenticated;
grant execute on function public.admin_overview()                                 to authenticated;
grant execute on function public.admin_apply_assignments(text, jsonb, jsonb)      to authenticated;
grant execute on function public.admin_set_participating(text, boolean)           to authenticated;
grant execute on function public.admin_remove_comment(uuid, text)                 to authenticated;
grant execute on function public.admin_restore_comment(uuid)                      to authenticated;
grant execute on function public.admin_set_open(boolean)                          to authenticated;
grant execute on function public.admin_set_allow_extra(boolean)                   to authenticated;

-- Done. Next: supabase/SETUP.md (add your instructor e-mail, upload the roster and the access codes).
