# Live mode: Supabase setup (instructor)

> **Do not switch the public site to Live mode (`VITE_FEEDBACK_MODE=live`) until every box in
> [Before going live](#7-before-going-live-checklist) is ticked.** Until then, keep the site in Demo mode. Demo mode
> stores nothing on a server and cannot leak or lose student feedback.

Live mode keeps comments in a free Supabase Postgres database. The browser holds only the **public** key, the one
Supabase calls *anon* or *publishable*. Everything else is locked inside the database (see the header of
`supabase/migrations/001_feedback_classroom.sql`).

**Never** put the `service_role` / *secret* key in the frontend, in a GitHub variable or secret used by the site build,
in `.env` files, or anywhere in this repository. The app never needs it.

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
select has_table_privilege('anon', 'public.comments', 'select')           as anon_reads_comments,
       has_table_privilege('authenticated', 'public.access_codes', 'select') as students_read_codes,
       has_function_privilege('anon', 'public.submit_comment(text,text,text,text)', 'execute') as anon_submits;
```

## 3. Authentication settings

In **Authentication**:

1. **Sign In / Providers → Anonymous Sign-Ins**: turn **on**. Students sign in anonymously and then prove who they
   are with their personal access code. A typed name is never used as identity.
2. **Sign In / Providers → Email**: make sure it is **enabled**. You, the instructor, sign in with a magic link.
3. **URL Configuration**:
   * **Site URL**: `https://academiccat16.github.io/share-your-thoughts-fairfield/`
   * **Redirect URLs**: add `https://academiccat16.github.io/share-your-thoughts-fairfield/` (and, only while testing
     locally, `http://localhost:5173/`; remove it afterwards).
4. **Rate Limits**: keep Supabase's built-in limits on. Check that the limit for *anonymous sign-ins* is modest. A
   few dozen per hour per IP is plenty for one classroom, but note that a whole class on the campus Wi-Fi may share
   one IP address, so do not set it below about 60 per hour.
5. **Attack Protection → CAPTCHA** (optional): Supabase can require hCaptcha/Turnstile for anonymous sign-ins. Only
   turn this on if the app's sign-in screen has been built to send a captcha token. Otherwise every student sign-in
   will fail. If in doubt, leave it off and rely on the rate limits plus the access codes.

The database also does its own rate limiting (`settings.min_seconds_between_writes` = 15 s,
`settings.max_writes_per_hour` = 20 per student) and locks a student's code for 15 minutes after 5 wrong tries.

## 4. Make yourself the instructor

In the SQL editor (use the e-mail address you will sign in with; capitalisation does not matter):

```sql
insert into public.instructors (email) values ('your.name@fairfield.edu') on conflict do nothing;
```

Only a real e-mail sign-in counts. An anonymous session that somehow carries the same address is refused.

## 5. Upload the roster and the access codes

On your own computer, in this repository:

```bash
npm run import-roster        # spreadsheet → src/data/roster.json (if not done already)
npm run live-sql             # → supabase/seed/roster_upsert.sql   (names + project links, no codes)
npm run access-codes         # → private/access_codes_<date>.csv  (the codes, for you only)
                             #   private/access_codes_upsert.sql   (bcrypt hashes only)
```

Then in the Supabase SQL editor, **in this order**:

1. Paste and run `supabase/seed/roster_upsert.sql`.
2. Paste and run `private/access_codes_upsert.sql`.

Hand each student **their own** code from `private/access_codes_<date>.csv` privately, for example in a private
message or on a slip of paper. Never post the sheet, and never commit the `private/` folder (it is git-ignored).
`npm run access-codes` does not print codes and does not send anything anywhere.

* **A student lost their code / it may have leaked**: `npm run access-codes -- --only s01-03`, then run the new
  `private/access_codes_upsert.sql`. Their old code stops working and any lock-out is cleared. The new sheet is
  written next to the old one, with a `_2`, `_3`… suffix if one already exists for today.
* **Unlock a student without changing the code**:
  `update public.access_codes set failed_attempts = 0, locked_until = null where student_id = 's01-03';`
  (live counters: `select * from feedback_private.access_code_status;`).
* **Roster changed**: `npm run import-roster`, then `npm run live-sql`, and run the new `roster_upsert.sql`. Students
  who left are set inactive, not deleted, so comments stay linked. Generate codes for newcomers with `--only`.

## 6. Point the site at the project (GitHub repository *variables*)

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
3. Re-run the Pages deployment workflow (or push a commit) so the site is rebuilt with the new values.

## 7. Before going live: checklist

Do these against the **real** Supabase project, with a temporary build or local `npm run dev` pointed at it (a `.env.local`
with the three variables above; `.env*` files are git-ignored). Keep the public site in Demo mode meanwhile.

- [ ] **Two-browser test.** In two different browsers (or one normal and one private window), sign in as two
      different students with their codes. Student A leaves feedback on B's world; B sees it after a refresh; A can
      edit it; B cannot edit it. A wrong code shows "didn't match", and five wrong codes lock that student out.
- [ ] **Instructor test.** Sign in with your e-mail magic link and open the dashboard. Remove A's comment (B's desk
      shows one fewer), restore it, then close and reopen feedback.
- [ ] **Concurrency test.** Pick one world and bring it to 3 comments. Then have at least 3 people (or browsers
      signed in as different students) press **Send** on that same world at the same moment. Exactly one must
      succeed; the others must see "This desk is full". Confirm in the SQL editor:
      `select project_id, count(*) from public.comments where status = 'published' group by 1 having count(*) > 4;`
      must return **no rows**.
- [ ] **Clean up the test data**:
      `delete from public.comments; delete from public.reservations; delete from public.write_events; delete from public.student_sessions;`
      Then regenerate and redistribute access codes if test codes were shared with anyone.
- [ ] Only now set `VITE_FEEDBACK_MODE` to `live` and redeploy.

The automated tests in this repository (`npm run test:db`) run the same SQL against a local, throw-away Postgres with
stand-ins for Supabase's roles and `auth.uid()`/`auth.jwt()`. They do not exercise Supabase itself (its API gateway,
auth server or rate limits), and that is why the checklist above is still required.

## Changing the rules

The numbers live in one row and can be changed at any time in the SQL editor, e.g.

```sql
update public.settings set max_comments_per_project = 5 where id = 1;
update public.settings set feedback_open = false where id = 1;  -- same as "close feedback" on the dashboard
```

Keep `shared/rules.ts` in step (it drives Demo mode and the messages shown to students), and keep
`public.blocked_terms` in step with `BLOCKED_TERMS` there.
