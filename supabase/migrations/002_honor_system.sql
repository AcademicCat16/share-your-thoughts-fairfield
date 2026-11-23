-- =====================================================================================================================
--  Fairfield Interactive Worlds — migration 002: HONOR-SYSTEM student feedback (no access codes, no student accounts)
-- =====================================================================================================================
--
--  WHAT CHANGES
--    Students no longer sign in. They pick their own name from a list, and the SERVER checks every submission against
--    that SELECTED name: the selected student must be active, in the project's course, not the project's owner, not
--    already have reviewed it, and have it on their assignment list (or be allowed an extra review); the project must
--    have a free slot. Capacity is protected by the same row locks as before (two simultaneous last-slot submissions:
--    exactly one wins).
--
--  WHAT THIS DOES NOT DO — READ THIS
--    Choosing a name is an HONOR SYSTEM. The server cannot know who is really at the keyboard, so anyone with the
--    link can submit under any classmate's name. "No self-review", "own course only" and "no duplicates" are enforced
--    for the SELECTED name only — they are not tamper-proof identity checks. The instructor can remove a comment
--    (which frees the slot and reopens that assignment) and can pause feedback at any time.
--
--  ABUSE LIMITS (all server-side, in addition to the per-project capacity and per-name rules)
--    * per selected name: min_seconds_between_writes (default 15 s) and max_writes_per_hour (default 20)  [from 001]
--    * per device/network: max_anon_writes_per_source_hour (default 240; a whole class may share one campus IP)
--    * whole site:         max_anon_writes_global_hour      (default 600)
--    The "source" is a SHA-256 hash of the client address that Supabase's gateway forwards; the address itself is
--    never stored. It is best-effort (shared networks look like one source).
--
--  EDITING
--    A successful submission returns a random edit token (shown only to that browser, stored there). Only its SHA-256
--    hash is kept. Editing needs the token, so a comment can be edited from the browser that wrote it — not by someone
--    who merely picks the same name. Edits never use a slot.
--
--  KEPT
--    All tables and rows. The access-code functions from 001 stay in the database but are unused by the app; students
--    can no longer reach them once Anonymous Sign-Ins are switched off (supabase/config.toml).
--
--  Safe to run more than once.
-- =====================================================================================================================

alter table public.settings add column if not exists max_anon_writes_per_source_hour int not null default 240
  check (max_anon_writes_per_source_hour >= 0);
alter table public.settings add column if not exists max_anon_writes_global_hour int not null default 600
  check (max_anon_writes_global_hour >= 0);

alter table public.comments add column if not exists edit_token_hash text null;

create table if not exists public.source_events (
  id          bigint generated always as identity primary key,
  source_hash text not null,
  kind        text not null,
  at          timestamptz not null default now()
);
create index if not exists source_events_at_idx     on public.source_events (at);
create index if not exists source_events_source_idx on public.source_events (source_hash, at);
alter table public.source_events enable row level security;
revoke all on table public.source_events from public;
do $$ begin
  execute 'revoke all on table public.source_events from anon, authenticated';
  execute 'revoke all on sequence public.source_events_id_seq from anon, authenticated';
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
--  Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------------------------------------------------------

-- SHA-256 of the client address forwarded by the API gateway (never the address itself).
create or replace function public._request_source()
returns text
language plpgsql stable security definer
set search_path = public, extensions, pg_temp
as $$
declare
  h  jsonb;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null;
  end;
  ip := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                 nullif(btrim(h ->> 'x-real-ip'), ''),
                 nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''),
                 'unknown');
  return encode(sha256(convert_to('fic-source:' || ip, 'UTF8')), 'hex');
end $$;

-- Per-source and site-wide limits for anonymous writes. Serialised per source so parallel requests cannot slip past.
create or replace function public._check_source_rate(p_source text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v public.settings := public._settings();
begin
  perform pg_advisory_xact_lock(hashtext('fic.source.' || p_source));
  if (select count(*) from public.source_events e
       where e.source_hash = p_source and e.at > now() - interval '1 hour') >= v.max_anon_writes_per_source_hour then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.source_events e where e.at > now() - interval '1 hour') >= v.max_anon_writes_global_hour then
    raise exception 'rate_limited';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
--  Public (anon) API
-- ---------------------------------------------------------------------------------------------------------------------

-- Published comments of one project (the same text everyone saw in the original demo). No hidden/inactive projects.
create or replace function public.get_project_comments(p_project_id text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select c.id, c.project_id, c.reviewer_id, c.reviewer_name, c.pronouns, c.enjoyed, c.suggestion, c.created_at, c.updated_at
    from public.comments c
    join public.students s on s.id = c.project_id and s.active and not s.hidden
   where c.project_id = p_project_id and c.status = 'published'
   order by c.created_at, c.id
$$;

-- The Feedback Quest of the SELECTED student (honor system: anyone can look up any name's list).
create or replace function public.get_student_quest(p_student_id text)
returns table (project_id text, status text, comment_id uuid, published int, capacity int)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select x.pid, x.st, x.cid, public._published(x.pid), public._capacity(x.pid)
    from (select a.project_id as pid, a.status as st, a.comment_id as cid
            from public.assignments a
           where a.reviewer_id = p_student_id and a.status in ('pending', 'completed')
          union all
          select c.project_id, 'extra', c.id
            from public.comments c
           where c.reviewer_id = p_student_id and c.extra and c.status = 'published') x
   where exists (select 1 from public.students s where s.id = p_student_id and s.active and not s.hidden)
   order by case x.st when 'completed' then 0 when 'extra' then 1 else 2 end, md5(p_student_id || x.pid)
$$;

-- Submit feedback under a SELECTED name. Same rules as 001's submit_comment, checked for that name.
create or replace function public.submit_feedback(p_reviewer_id text, p_project_id text, p_pronouns text,
                                                  p_enjoyed text, p_suggestion text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz, edit_token text)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_set    public.settings := public._settings();
  v_src    text := public._request_source();
  v_course text;
  v_name   text;
  v_txt    record;
  v_pub    int;
  v_cap    int;
  v_extra  bool := false;
  v_token  text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_row    public.comments;
begin
  if not v_set.feedback_open then raise exception 'closed'; end if;
  select s.course, s.full_name into v_course, v_name
    from public.students s where s.id = p_reviewer_id and s.active and not s.hidden;
  if v_course is null then raise exception 'unknown_reviewer'; end if;
  if not public._eligible(p_project_id) then raise exception 'project_unavailable'; end if;
  if p_project_id = p_reviewer_id then raise exception 'self_review'; end if;
  if not exists (select 1 from public.students s where s.id = p_project_id and s.course = v_course) then
    raise exception 'wrong_course';
  end if;
  select * into v_txt from public._validate_feedback(p_pronouns, p_enjoyed, p_suggestion);

  -- Same locking as 001: reviewer row and project row (lower id first), then everything is re-read.
  perform public._lock_pair(p_reviewer_id, p_project_id);
  if not public._eligible(p_project_id) then raise exception 'project_unavailable'; end if;
  v_set := public._settings();
  if not v_set.feedback_open then raise exception 'closed'; end if;

  perform public._check_source_rate(v_src);
  perform public._check_rate(p_reviewer_id);
  if exists (select 1 from public.comments c where c.project_id = p_project_id and c.reviewer_id = p_reviewer_id) then
    raise exception 'already_reviewed';
  end if;

  v_pub := public._published(p_project_id);
  v_cap := public._capacity(p_project_id);
  if not exists (select 1 from public.assignments a
                  where a.reviewer_id = p_reviewer_id and a.project_id = p_project_id and a.status = 'pending') then
    if v_set.allow_extra_reviews
       and (select count(*) from public.comments c where c.reviewer_id = p_reviewer_id and c.status = 'published') >= v_set.reviews_per_student
       and v_pub + (select count(*) from public.assignments a
                     where a.project_id = p_project_id and a.status = 'pending' and a.reviewer_id <> p_reviewer_id) < v_cap then
      v_extra := true;
    else
      raise exception 'not_assigned';
    end if;
  end if;
  if v_pub >= v_cap then raise exception 'project_full'; end if;

  insert into public.comments (course, project_id, reviewer_id, reviewer_name, pronouns, enjoyed, suggestion, extra, edit_token_hash)
  values (v_course, p_project_id, p_reviewer_id, v_name, v_txt.pronouns, v_txt.enjoyed, v_txt.suggestion, v_extra,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  returning * into v_row;
  update public.assignments a
     set status = 'completed', comment_id = v_row.id, updated_at = now()
   where a.reviewer_id = p_reviewer_id and a.project_id = p_project_id and a.status = 'pending';
  insert into public.write_events (student_id, kind) values (p_reviewer_id, case when v_extra then 'submit_extra' else 'submit' end);
  insert into public.source_events (source_hash, kind) values (v_src, 'submit');

  return query select v_row.id, v_row.project_id, v_row.reviewer_id, v_row.reviewer_name, v_row.pronouns,
                      v_row.enjoyed, v_row.suggestion, v_row.created_at, v_row.updated_at, v_token;
end $$;

-- Edit a comment with the edit token its browser received. Never uses a slot.
create or replace function public.edit_feedback(p_comment_id uuid, p_edit_token text, p_pronouns text,
                                                p_enjoyed text, p_suggestion text)
returns table (id uuid, project_id text, reviewer_id text, reviewer_name text, pronouns text, enjoyed text,
               suggestion text, created_at timestamptz, updated_at timestamptz)
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_src text := public._request_source();
  v_cur public.comments;
  v_txt record;
  v_row public.comments;
begin
  select * into v_cur from public.comments c where c.id = p_comment_id and c.status = 'published';
  if not found then raise exception 'not_found'; end if;
  if v_cur.edit_token_hash is null or coalesce(p_edit_token, '') = ''
     or v_cur.edit_token_hash <> encode(sha256(convert_to(p_edit_token, 'UTF8')), 'hex') then
    raise exception 'not_author';
  end if;
  if not (public._settings()).feedback_open then raise exception 'closed'; end if;
  select * into v_txt from public._validate_feedback(p_pronouns, p_enjoyed, p_suggestion);
  perform 1 from public.students s where s.id = v_cur.reviewer_id for update;   -- serialise this name's writes
  perform public._check_source_rate(v_src);
  perform public._check_rate(v_cur.reviewer_id);
  perform 1 from public.comments c where c.id = p_comment_id and c.status = 'published' for update;
  if not found then raise exception 'not_found'; end if;           -- removed by the instructor while waiting

  update public.comments c
     set pronouns = v_txt.pronouns, enjoyed = v_txt.enjoyed, suggestion = v_txt.suggestion, updated_at = now()
   where c.id = p_comment_id
  returning * into v_row;
  insert into public.write_events (student_id, kind) values (v_cur.reviewer_id, 'update');
  insert into public.source_events (source_hash, kind) values (v_src, 'update');

  return query select v_row.id, v_row.project_id, v_row.reviewer_id, v_row.reviewer_name, v_row.pronouns,
                      v_row.enjoyed, v_row.suggestion, v_row.created_at, v_row.updated_at;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
--  Privileges: helpers callable by nobody; the four public functions by anon + authenticated only.
-- ---------------------------------------------------------------------------------------------------------------------
revoke all on function public._request_source()                                   from public;
revoke all on function public._check_source_rate(text)                            from public;
revoke all on function public.get_project_comments(text)                          from public;
revoke all on function public.get_student_quest(text)                             from public;
revoke all on function public.submit_feedback(text, text, text, text, text)       from public;
revoke all on function public.edit_feedback(uuid, text, text, text, text)         from public;
do $$ begin
  execute 'revoke all on function public._request_source() from anon, authenticated';
  execute 'revoke all on function public._check_source_rate(text) from anon, authenticated';
exception when undefined_object then null;
end $$;
grant execute on function public.get_project_comments(text)                      to anon, authenticated;
grant execute on function public.get_student_quest(text)                         to anon, authenticated;
grant execute on function public.submit_feedback(text, text, text, text, text)   to anon, authenticated;
grant execute on function public.edit_feedback(uuid, text, text, text, text)     to anon, authenticated;
