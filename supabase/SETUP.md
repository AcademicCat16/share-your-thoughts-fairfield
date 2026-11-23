# Live mode: Supabase setup and operation (instructor)

The production project is **`fairfield-interactive-worlds`** (ref `amtzwcanjylvrmqroeku`). It is linked to this folder
with the official Supabase CLI (`npx supabase …`; it is a pinned dev dependency). Do not create another project.

Live mode keeps comments in Supabase Postgres. The browser holds only the **publishable** (anon) key. Everything else
is locked inside the database: row-level security on every table, no table grants, and only `SECURITY DEFINER`
functions as the way in (`supabase/CONTRACT.md`, headers of the migrations).

**Never** put the `service_role` / *secret* key in the frontend, a GitHub variable or secret, a `.env` file, or anywhere
in this repository. The app never needs it.

## How it works now (since migration 002)

**Students — honor system, no accounts.** A student opens a classmate's project, presses **Leave Your Thoughts**,
picks **their own name** from a dropdown listing their course, writes a compliment and a suggestion, and sends it.

> **Choosing a name does not verify identity.** The server cannot know who is really typing: anyone with the link can
> pick any classmate's name. The rules below are enforced on the server **for the selected name** — they are honest
> guard-rails, not tamper-proof identity checks.

For the selected name the server checks: the name is on the active roster; the project has a working link; the
project is in the same course; it is not the student's own project; that name has not already reviewed it; the project
is on that name's assignment list (or extra reviews are switched on and that name has finished four); the project has
a free slot (row-locked, so two simultaneous last-slot submissions → exactly one succeeds).

Abuse limits, all on the server: per name one write per 15 s and 20 per hour; per device/network (a SHA-256 hash of
the forwarded client address, never the address itself) 240 per hour — a class shares one campus IP; for the whole
site 600 per hour. Every comment also needs an open assignment, so the total is bounded by the plan (344 + extras).

**Editing.** Sending a review returns a random edit token to that browser (only its hash is stored). The comment can
be edited from that browser; picking the same name elsewhere does not allow editing. Edits never use a slot.

**What is public.** Comments are visible to anyone who opens the site (as in the original demo), and anyone can see
which projects are on a name's Feedback Quest. See `docs/PRIVACY_REVIEW.md`.

**If someone misuses a name.** Dashboard → moderation → **Remove** the comment (the slot is freed and that
assignment is open again for the real student). **Pause feedback** stops all writes at once.

**Instructor — e-mail + password.** The dashboard uses Supabase e-mail/password sign-in. Instructor rights are checked
on the server for every action (`public.is_instructor()`: a non-anonymous signed-in user whose e-mail is in
`public.instructors`). The app never stores the password; the session lives in the tab's `sessionStorage` and ends when
the tab is closed.

*Why not the e-mail link any more?* The Auth logs showed every magic link being opened by an automated mail scanner
within 4–8 seconds of sending (`GET`/`HEAD /verify`), which used up the single-use token; your own click then failed
with "Email link is invalid or has expired" and landed back on the sign-in page. Passwords avoid that entirely.

---

## Instructor password

* **Set it the first time / forgot it** — in the Supabase dashboard, nothing typed into this repository or a terminal:
  1. **Authentication → Users**, find your e-mail, open the **⋯** menu → **Delete user**. (This removes only the login;
     your instructor entry in `public.instructors` is keyed by e-mail and stays.)
  2. **Add user → Create new user**: the same e-mail, a new password of **at least 12 characters** (a passphrase from
     your password manager), tick **Auto Confirm User**, **Create user**.
  3. Sign in on the site → **Instructor**.
  *(Avoid "Send password recovery": it is an e-mailed single-use link, which the Fairfield mail scanner breaks in the
  same way it broke the magic link.)*
* **Change it while signed in** — Dashboard → **Change password** (at least 12 characters).
* **Add another instructor** — create their user as in step 2, then in the SQL editor:
  `insert into public.instructors (email) values ('colleague@fairfield.edu') on conflict do nothing;`

## Applying database changes (CLI)

```bash
npx supabase login                         # once, in your own terminal (browser approval)
npx supabase link --project-ref amtzwcanjylvrmqroeku
npx supabase db push --remote --dry-run    # shows which migrations would run
npx supabase db push --remote              # applies them (asks for confirmation)
npx supabase config diff                   # auth settings: supabase/config.toml declares only what the app needs
npm run verify:prod                        # read-only lock-down checks against production
```

Migrations are additive and safe to run again; they never delete students, assignments or comments.

## Auth settings (`supabase/config.toml`, applied with `npx supabase config push`)

* Site URL / redirect URL: the GitHub Pages address.
* **Anonymous sign-ins: off** and **new sign-ups: off** — students need no accounts; instructors are created in the
  dashboard.
* Minimum password length 12.

## Roster and assignments

* `npm run import-roster`, `npm run audit-links` (only "working" links can receive reviews), `npm run live-sql`
  → run the generated SQL with `npx supabase db query --remote --file private/roster_upsert.sql`. Students who leave
  the roster are set inactive, never deleted.
* Assignments: Dashboard → **Generate reviewer assignments** per course (keeps finished reviews). Only after roster or
  link changes.

## Going live with students

1. Sign in to the dashboard and check the numbers (86 students, 81 working, 344 reviews required, assignments 112/232).
2. **Reopen feedback** on the dashboard when you are ready. Until then students can explore and read but not send.
3. Tell students: open a classmate's world → **Leave Your Thoughts** → choose **your own** name → two answers → send.

## Changing the rules

```sql
update public.settings set reviews_per_student = 3 where id = 1;               -- reviews each student must write
update public.settings set base_slots = 5 where id = 1;                        -- standard slots per project
update public.settings set allow_extra_reviews = true where id = 1;            -- same as the dashboard switch
update public.settings set feedback_open = false where id = 1;                 -- same as "pause" on the dashboard
update public.settings set max_anon_writes_per_source_hour = 400 where id = 1; -- larger class on one network
```

After changing `reviews_per_student` or `base_slots`, generate the assignments again. Keep `shared/rules.ts` in step.

## Legacy (migration 001)

The access-code tables and functions from the first Live version are still in the database (no data was deleted), but
the app no longer uses them, and students cannot reach them while anonymous sign-ins are off. The private code sheet in
`private/` is no longer needed; keep it private or delete it.
