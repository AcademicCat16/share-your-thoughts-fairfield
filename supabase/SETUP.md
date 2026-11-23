# Live mode: Supabase setup (instructor)

> **Do not switch the public site to Live mode (`VITE_FEEDBACK_MODE=live`) until every box in
> [Verify before telling students](#8-verify-before-telling-students) is ticked.** Until then, keep the site in Demo
> mode. Demo mode stores nothing on a server and cannot leak or lose student feedback.

Live mode keeps comments in a free Supabase Postgres database. The browser holds only the **public** key, the one
Supabase calls *anon* or *publishable*. Everything else is locked inside the database (see the header of
`supabase/migrations/001_feedback_classroom.sql` and `supabase/CONTRACT.md`).

**Never** put the `service_role` / *secret* key in the frontend, in a GitHub variable or secret used by the site build,
in `.env` files, or anywhere in this repository. The app never needs it.

How it works, in one paragraph: each student gets a private **access code** (like `XXXX-XXXX-XXXX`). They type only
that code; the database works out who they are. A typed name is never used. You, the instructor, sign in with an
e-mail link and, on the dashboard, generate each course's **review assignments** (every student gets 4 classmates'
projects from their own course). Students can review only the projects assigned to them, and a project never receives
more comments than its number of slots.

---

## 1. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> and click **New project** (the Free plan is enough).
2. Pick a name (e.g. `feedback-classroom`) and a strong database password. Store the password in your password
   manager. The app never uses it.
3. Choose the region closest to campus (e.g. *East US*) and wait for the project to finish provisioning.

## 2. Run the migration

1. In the project, open **SQL Editor → New query**.
2. Open `supabase/migrations/001_feedback_classroom.sql` from this repository, copy **all** of it, paste it, and click
   **Run**. It should finish with "Success. No rows returned".
3. The file is safe to run again later (for example after an update to the app). It never deletes students or
   comments.

Optional sanity check (run in the SQL editor; every value should be `false`):

```sql
select has_table_privilege('anon', 'public.comments', 'select')               as anon_reads_comments,
       has_table_privilege('authenticated', 'public.access_codes', 'select')  as students_read_codes,
       has_function_privilege('anon', 'public.submit_comment(text,text,text,text)', 'execute') as anon_submits;
```

## 3. Authentication settings

In **Authentication**:

1. **Sign In / Providers → Anonymous Sign-Ins**: turn **on**. Students sign in anonymously and then prove who they
   are with their personal access code.
2. **Sign In / Providers → Email**: make sure it is **enabled**. You, the instructor, sign in with a magic link.
3. **URL Configuration**:
   * **Site URL**: `https://academiccat16.github.io/share-your-thoughts-fairfield/`
   * **Redirect URLs**: add `https://academiccat16.github.io/share-your-thoughts-fairfield/` (and, only while testing
     locally, `http://localhost:5173/`; remove it afterwards).
4. **Rate Limits**: keep Supabase's built-in limits on. A whole class on the campus Wi-Fi may share one IP address,
   so do not set the *anonymous sign-ins* limit below about 60 per hour.
5. **Attack Protection → CAPTCHA**: leave it **off** unless the app's sign-in screen has been built to send a captcha
   token (otherwise every student sign-in fails).

The database also protects itself: a browser that types 10 wrong codes within 15 minutes is paused for the rest of
those 15 minutes, all browsers together may make at most 300 wrong tries per 15 minutes, and each student can send at
most one comment or edit every 15 seconds and 20 per hour.

## 4. Make yourself the instructor

In the SQL editor (use the e-mail address you will sign in with; capitalisation does not matter):

```sql
insert into public.instructors (email) values ('your.name@fairfield.edu') on conflict do nothing;
```

Only a real e-mail sign-in counts. An anonymous session that somehow carries the same address is refused.

## 5. Check the project links, then upload the roster

On your own computer, in this repository, run these **in this order**:

1. `npm run import-roster` — reads the exam workbook and writes `private/roster_full.json` (both courses: MKTG 1101
   and MKTG 2241 sections 01 + 02).
2. `npm run audit-links` — opens every submitted project link in a real browser and records whether it works. **Only
   projects marked "working" can receive reviews.** Read `docs/FINAL_PROJECT_LINK_AUDIT.md` afterwards; a broken link
   is not the student's final answer — they can send you a corrected link and you re-run steps 1–3.
3. `npm run live-sql` — writes `supabase/seed/roster_upsert.sql` (names, courses, project links and link results; no
   codes).
4. In the Supabase SQL editor, paste and run `supabase/seed/roster_upsert.sql`.

Students who are no longer on the roster are set *inactive*, never deleted, so their comments stay linked. Whether a
student takes part (the "participating" switch on the dashboard) is kept when you upload the roster again.

## 6. Create and hand out the access codes

1. `npm run access-codes` — writes two files in the private folder:
   * `private/access_codes_<date>.csv` — one code per student (open it in Excel). **For you only.**
   * `private/access_codes_upsert.sql` — the scrambled (hashed) form of the codes, for the database.
2. In the Supabase SQL editor, paste and run `private/access_codes_upsert.sql` (always **after** the roster upload).
3. Give each student **their own** code privately, for example in a private message or on a slip of paper. Never post
   the sheet, and never commit the `private/` folder (it is git-ignored). `npm run access-codes` does not print codes
   and does not send anything anywhere.

Students sign in with the code alone. Upper or lower case, spaces and dashes do not matter.

* **A student lost their code, or it may have leaked**: `npm run access-codes -- --only s01-03` (several:
  `--only s01-03,pm-07`), then run the new `private/access_codes_upsert.sql`. Their old code stops working at once.
  The new sheet is written next to the old one, with a `_2`, `_3`… suffix if one already exists for today.
* **Block a code without issuing a new one**:
  `update public.access_codes set revoked_at = now() where student_id = 's01-03';`
* **A browser was paused after too many wrong codes** (it lifts by itself after 15 minutes; to lift it now):
  `delete from public.code_attempts where not ok;`
* **Roster changed**: repeat step 5, then generate codes for newcomers only, with `--only`.

## 7. Point the site at the project, then generate the assignments

1. In Supabase, open **Project Settings → API Keys** (older dashboards: **Project Settings → API**). Copy the
   **Project URL** and the **anon / publishable** key. Do **not** copy the `service_role` / secret key.
2. On GitHub, open the repository → **Settings → Secrets and variables → Actions → Variables** tab →
   **New repository variable**, and add:

   | name | value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |
   | `VITE_FEEDBACK_MODE` | `demo` for now, and `live` **only after** the checklist below |

   These are *variables*, not secrets. The anon key ends up in the public JavaScript bundle by design, and it is
   safe there only because the database is locked down as described above.
3. Re-run the Pages deployment workflow (or push a commit) so the site is rebuilt with the new values. For the checks
   in step 8 you can instead run `npm run dev` locally with a `.env.local` holding the three variables (`.env*` files
   are git-ignored).
4. Sign in to the **instructor dashboard** with your e-mail link. For **each course** (1101, then 2241), press
   **Generate assignments**, look at the summary (every student should get 4 projects; when there are more reviewers
   than standard slots, some projects get a fifth slot), and press **Apply**. The database checks the whole plan again
   and refuses it if anything is wrong (for example a broken link or a student reviewing themselves). Generate again
   after any roster or link change; finished reviews are always kept.

## 8. Verify before telling students

Do these against the **real** Supabase project (a temporary build, or `npm run dev` pointed at it). Keep the public
site in Demo mode meanwhile. Use a few real codes from the sheet for testing, and re-issue those codes afterwards
(`npm run access-codes -- --only …`).

- [ ] **Two browsers see the same comment.** In two different browsers (or one normal and one private window), sign
      in as two different students of the same course with their codes. Student A opens a project on their quest list
      and leaves feedback; in the other browser B refreshes and sees exactly that comment. A can edit it; B cannot.
- [ ] **Wrong code refused.** Type a made-up code: it says the code didn't match, and you stay signed out. Type the
      right code in lower case without dashes: it works.
- [ ] **Course boundary.** Signed in as a MKTG 1101 student, open a MKTG 2241 project: you can explore and read it,
      but the feedback form refuses ("You can review only projects in your own course"). Try the reverse direction too.
- [ ] **Full project.** Pick one project and fill all its slots (assigned reviewers submit until it shows full). Then,
      as another student, open it: submitting is refused with the "All comment slots are full" message, **but the
      project's website still opens** and the existing comments can still be read. Confirm in the SQL editor that
      nothing is over capacity (must return **no rows**):
      ```sql
      select s.id, count(c.*) as published, coalesce(ps.capacity, (select base_slots from public.settings)) as capacity
        from public.students s
        left join public.comments c on c.project_id = s.id and c.status = 'published'
        left join public.project_slots ps on ps.project_id = s.id
       group by s.id, ps.capacity
      having count(c.*) > coalesce(ps.capacity, (select base_slots from public.settings));
      ```
- [ ] **Instructor dashboard and moderation.** Sign in with your e-mail link and open the dashboard. Remove A's
      comment (it disappears for B after a refresh, and the slot is free again), then restore it.
- [ ] **Pause works.** Press pause on the dashboard. A student trying to send or edit feedback is told feedback is
      closed. Press resume and check that sending works again.
- [ ] **Clean up the test data**, then generate the assignments again (step 7.4):
      ```sql
      delete from public.assignments; delete from public.comments; delete from public.write_events;
      delete from public.student_sessions; delete from public.code_attempts; delete from public.project_slots;
      ```
      Re-issue the codes you used for testing.
- [ ] Only now set `VITE_FEEDBACK_MODE` to `live`, redeploy, and hand out the codes.

The automated tests in this repository (`npm run test:db`) run the same SQL against a local, throw-away Postgres with
stand-ins for Supabase's roles and `auth.uid()`/`auth.jwt()`. They do not exercise Supabase itself (its API gateway,
auth server or rate limits), which is why the checklist above is still required.

## Changing the rules

The numbers live in one row and can be changed at any time in the SQL editor, e.g.

```sql
update public.settings set reviews_per_student = 3 where id = 1;          -- reviews each student must write
update public.settings set base_slots = 5 where id = 1;                   -- standard slots per project
update public.settings set allow_extra_reviews = true where id = 1;       -- same as the dashboard switch
update public.settings set feedback_open = false where id = 1;            -- same as "pause" on the dashboard
```

After changing `reviews_per_student` or `base_slots`, generate the assignments again. Keep `shared/rules.ts` in step
(it drives Demo mode and the messages shown to students), and keep `public.blocked_terms` in step with
`BLOCKED_TERMS` there.
