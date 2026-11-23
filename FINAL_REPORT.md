# Fairfield Interactive Worlds — implementation report

Production upgrade of the Thanksgiving demo into a two-classroom peer-feedback site (MKTG 1101 + MKTG 2241).
Report date: 2026-11-23. Rollback point: git tag `v1-demo-2026-11-19` (the first demo).

Status labels: **COMPLETED** (built) · **TESTED** (exercised by an automated test that was actually run, or a screenshot that was
looked at) · **DEPLOYED** (verified on the public URL) · **DEMO ONLY** · **NEEDS CONFIGURATION** · **BLOCKED**.

> **Update 2026-11-23 — Live mode connected.** The public site now runs in **Live mode** on the production Supabase project
> `fairfield-interactive-worlds`, set up with the official Supabase CLI. The migration was applied, auth was configured,
> and the roster (86), access-code hashes (86), instructor and assignments (112 + 232) are loaded. The production checks
> pass: lock-down 17/17 (`npm run verify:prod`) and the two-browser test on the deployed site 9/9
> (`tests/prod/live-site.mjs`). **Student feedback is PAUSED** on purpose: no codes have been handed out yet. See
> "Production status" at the end. Sections 10–17 below describe the earlier, Demo-only state and are superseded by it.

## 1. Final student counts by course — COMPLETED, TESTED

Source: `Take-Home Exam (final).xlsm`, read as a zip/XML file (macros are never executed; the workbook has no VBA part anyway).
The older spreadsheet was not used. The workbook is git-ignored and is never published.

| Course | Students | Sections |
|---|---:|---|
| MKTG 1101 Principles of Marketing | 28 | one section |
| MKTG 2241 Digital Marketing | 58 | 2241-01: 28 · 2241-02: 30 |
| **Total** | **86** | |

Ids are stable: 1101 uses `pm-NN`, 2241 keeps the v1 ids `s01-NN` / `s02-NN`, so every 2241 student keeps the creature they
had in the demo. Details: `docs/ROSTER_IMPORT_REPORT.md`.

## 2. Verified live website counts — COMPLETED, TESTED

`npm run audit-links` (2026-11-23) fetched every link over HTTPS, followed redirects one hop at a time, detected 404 and
"no GitHub Pages site here" pages, then opened each one in Chrome to confirm that something visibly renders. All 81 screenshots
were looked at. No student repository code was downloaded or run outside the browser.

| Course | Entries | Working | Broken | Missing |
|---|---:|---:|---:|---:|
| MKTG 1101 | 28 | **28** | 0 | 0 |
| MKTG 2241 | 58 | **53** | 0 | 5 |
| **All** | 86 | **81** | 0 | 5 |

Only *working* projects can receive reviews. Full table: `docs/FINAL_PROJECT_LINK_AUDIT.md`.

## 3. Missing or broken project URLs — COMPLETED, TESTED

No broken links. Five MKTG 2241 students have no project link in the workbook: Ainsley Gondek (`s01-01`),
Michael Gallagher (`s01-23`), Courtney Shyposh (`s02-08`), James Honekamp (`s02-13`) and Mason Carter (`s02-25`).
Each keeps their desk and name tag with an empty chair, the review button is off, and a friendly message is shown. They still
review four classmates. No replacement links were invented.

**Deviation to confirm:** the 2241 sheet now has a column F, "Published Website Link". For three students (DeBello, Rowland,
Caruso), column E holds the GitHub *repository* page and F holds the published site, so F was used for those three. A
repository page is not an interactive website. If you would rather treat them as missing, say so and re-run the import.

## 4. Correct use of 1101 Column E — COMPLETED, TESTED

The 1101 importer checks the column-E header and reads only column E. **Column D (personal website) is never read into the
roster.** There is no fallback to D. A unit test asserts this. One detail: Excel stores the part of a hyperlink after `#`
separately, so the importer uses the cell's own text when it is a URL. Without this, links such as `…/#sample-day` would
lose their fragment.

## 5. Two-class homepage — COMPLETED, TESTED, DEPLOYED (Demo)

"Fairfield Interactive Worlds", the requested subtitle, and two cards with "Enter Classroom":
*Principles of Marketing / MKTG 1101 / 28 Students* and *Digital Marketing / MKTG 2241 / 58 Students*. Every page has a
way back home. Routes: `#/`, `#/1101`, `#/2241`, `#/guide`, `#/instructor`; old `#/classroom` links open 2241.

## 6. Classroom seat counts — COMPLETED, TESTED

* 1101: 28 desks, two blocks of 14, with "MKTG 1101 · Principles of Marketing" floor signs.
* 2241: 58 desks, 28 + 30, in the original layout, with the section filter (2241-01 / 2241-02 / Both Sections). The two
  sections form one review pool.

Both the 3D and the 2D views are provided.

## 7. Character assignments — COMPLETED, TESTED

28 new original creatures for 1101 (a "Harvest Market Fair" theme, ids c59–c86). Each has its own name, personality,
ability and story. The 58 existing 2241 creatures are unchanged. The test checks 86 distinct names, with no creature
shared between the rooms. Creatures are tied to the student id, so a changed URL never reassigns a creature. Nothing is
franchise artwork, and there is no autoplay music.

## 8. Four-review assignment status — COMPLETED, TESTED (DEMO ONLY until Live mode is configured)

Every student gets **four** assigned classmates from their own course: never themselves and never the same project twice.
The plan is computed by a deterministic max-flow planner (`shared/allocation.ts`), and in Live mode it is re-validated
by the database (`admin_apply_assignments`).

* 1101: 28 × 4 = **112** reviews over 28 projects (4 slots each).
* 2241: 58 × 4 = **232** reviews over 53 projects.

Completed reviews are kept when plans are regenerated. "Rebalance" also keeps valid unfinished ones. Students can be marked
non-participating, and their slots are released. Infeasible plans are reported, not forced.

Exploring is unlimited, with "Explore Another World" and "Find My Next Review". Extra unassigned reviews are off unless
you switch them on in the dashboard.

## 9. Fifth-slot allocations — COMPLETED, TESTED

* 2241: 232 − 53 × 4 = **20** projects get one fifth slot, spread as evenly as possible.
* 1101: none needed (112 = 28 × 4).

A project never exceeds its slots. In Live mode this is enforced in the database with a per-project lock. A full project
shows "All comment slots are full! …" and stays fully explorable; only "Leave Your Thoughts" is turned off.

## 10. Shared database status — COMPLETED, TESTED locally · NEEDS CONFIGURATION

`supabase/migrations/001_feedback_classroom.sql` contains the tables, row-level security with no table access, and
security-definer RPCs only. That covers the course pools, assignments, slot capacity, the author-only edit, moderation,
pause and an audit log.

* `npm run test:db`: **50/50 passed** on a throw-away Postgres 17 with Supabase stand-in roles. The tests include the
  migration being re-run on live data and v1 → v2 conversion.
* It has **not** been run on a real Supabase project, because none exists yet.

## 11. Authentication status — COMPLETED, TESTED locally · NEEDS CONFIGURATION

**Students.** Students sign in with a **private access code** only: 12 random characters, `XXXX-XXXX-XXXX`.
* There is no name picker, and typed names are never trusted.
* Only SHA-256 hashes are stored.
* Codes are generated into the git-ignored `private/` folder, and no roster-to-code list is published.
* Wrong codes are throttled: 10 per browser session and 300 site-wide per 15 minutes.

**Instructor.** The instructor uses an e-mail magic link and must be listed in `public.instructors`.

## 12. Security test results — TESTED (locally)

From the 50 database tests:
* Anonymous visitors can call only three read-only functions, which return counts and on/off switches.
* No table is readable or writable directly.
* Self-reviews, other-course reviews, unassigned reviews, duplicate reviews and over-capacity reviews are refused by the
  server.
* Two simultaneous submissions to the last slot give exactly one success.
* Only the author can edit.
* Pause blocks submits and edits.
* Access codes are never printed by the scripts.

`npm run check:publish` passes. It scans the repository and the built site for workbooks, the private roster, code
sheets, code-shaped strings, hash uploads and Supabase secret keys. `docs/PRIVACY_REVIEW.md` lists exactly what is public.

**Known risk:** the site-wide code throttle means that someone deliberately sending 300 wrong codes within 15 minutes could
block sign-in for everyone for up to 15 minutes. Signed-in students are unaffected. You can raise the limit with one SQL
line (`update public.settings set max_failed_codes_global = 1000 where id = 1;`).

## 13. Browser test results — TESTED

| Suite | Browsers | Result |
|---|---|---|
| Unit tests (`npm test`) | — | 46/46 passed |
| Lint + type-check | — | clean |
| Demo-mode end-to-end, 20 scenarios (`npm run test:e2e`) | Chrome, Microsoft Edge | 20/20 each (re-run 2026-11-23 on the final code) |
| same | Firefox, WebKit (Playwright builds) | 20/20 each (earlier on 2026-11-23, before last DB-only changes) |
| **Live-mode** two-browser test (`npm run test:live`) | Chrome = student A, Edge = student B | **9/9 passed** |

The Live-mode test builds the production site in Live mode. It runs it against the real migration on a local Postgres,
behind a small local stand-in for Supabase's API and sign-in server. It covers:
* a public visitor;
* instructor magic-link sign-in and saving both plans;
* code-only sign-in;
* **a review sent in Browser A appearing in Browser B**;
* author-only editing;
* the course boundary;
* **two browsers sending to the last slot at the same moment** (exactly one succeeds);
* moderation and pause;
* no page errors.

The screenshots in `tests/output/live/` were looked at.

**Not tested:** real Safari (WebKit is close but not identical); phones were covered only by narrow-window screenshots; the
real Supabase servers. The official PostgREST binary was not used locally (its download was not permitted on this machine),
so the stand-in reproduces only the parts of Supabase's API the site uses.

## 14. GitHub commit information — COMPLETED

Commit `435160e` on `main` of `AcademicCat16/share-your-thoughts-fairfield`, pushed as a normal fast-forward from `d6a03e4`
(no force-push; history intact). The rollback tag `v1-demo-2026-11-19` is on GitHub. This report update is a small follow-up commit.

## 15. Deployment status — DEPLOYED (Demo mode)

GitHub Actions run 45140963924 for `435160e`: the **build** job passed every step on Ubuntu: lint, unit, database, build,
publication check, Demo e2e in Chrome and Edge, and the Live-mode two-browser test. The **deploy** job then published to
GitHub Pages. Live mode is NEEDS CONFIGURATION (section 17).

## 16. Verified public website URL

https://academiccat16.github.io/share-your-thoughts-fairfield/ — **DEPLOYED, verified 2026-11-23** in Chrome after the deploy:
* the homepage shows both classroom cards (28 / 58 students; 28 and 53 worlds ready);
* `#/1101` shows 28 desks with the 1101 creatures and floor signs;
* `#/2241` shows 58 desks with the section filter;
* `#/guide` loads;
* the Demo Mode banner is on every page, with no page errors.

## 17. Instructor actions still required

1. **Decide on public visibility** (`docs/PRIVACY_REVIEW.md`). Names and project links of all 86 students are visible to
   anyone with the link. Hide individuals if needed.
2. **Confirm the column F choice** for DeBello, Rowland and Caruso (section 3).
3. **To switch on shared commenting**, follow `supabase/SETUP.md` (about 30 minutes):
   * create a free Supabase project, then run the migration in its SQL editor;
   * turn on Anonymous Sign-Ins and Email, and set the Site URL to the Pages URL;
   * add your e-mail as instructor;
   * run `npm run live-sql` and `npm run access-codes` on your computer, and paste the two SQL files;
   * on GitHub → Settings → Secrets and variables → Actions → **Variables**, add `VITE_FEEDBACK_MODE=live`,
     `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the *publishable/anon* key — never the service-role/secret key);
   * re-run the workflow;
   * in the dashboard, **Generate reviewer assignments** for each course;
   * complete the "Verify before telling students" checklist (two different browsers);
   * hand out codes privately.

   Until then, tell students that Demo mode keeps comments only on their own device.

---

## Production status (2026-11-23, after connecting Supabase)

| Item | Status |
|---|---|
| Supabase project | `fairfield-interactive-worlds` (the existing project; none created). Linked with the official CLI 3.2.0 (pinned dev dependency) |
| Migration `001_feedback_classroom.sql` | **COMPLETED** on production (`supabase db push`), after a dry run and your approval |
| Auth settings | **COMPLETED** via `supabase config push` (only 4 declared settings): Site URL + redirect = GitHub Pages; anonymous sign-ins on; 150 anonymous sign-ins/hour/IP. E-mail provider was already on |
| Instructor | **COMPLETED**: Auth user created by you (auto-confirmed); e-mail registered in `public.instructors` |
| Roster / access codes | **COMPLETED**: 86 students (28 + 58), 81 reviewable; 86 SHA-256 code hashes. Plain codes only in `private/access_codes_2026-11-23.csv` (git-ignored) |
| Reviewer assignments | **COMPLETED, TESTED**: generated with the dashboard's planner and applied through the server-validated `admin_apply_assignments`. 1101: 112, 2241: 232; every student exactly 4; no self, cross-course, duplicate or ineligible pairs; every project at capacity; 20 fifth slots in 2241, none in 1101 |
| Database security on production | **TESTED**: 17/17 read-only lock-down checks: RLS on everywhere, no policies, no table/column/sequence grants, anon limited to 3 status functions, all functions SECURITY DEFINER with a pinned search_path, hashes only. Supabase advisor: no errors; 23 warnings, all the app's intended RPCs |
| GitHub Actions variables | **COMPLETED**: `VITE_FEEDBACK_MODE=live`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the *publishable* key; no secret key anywhere) |
| Deployment | **DEPLOYED**: CI run 45149365055 (build + deploy succeeded); the public site loads in Live mode with no page errors |
| Two-browser production test | **TESTED 9/9** (Chrome = student A, Edge = student B, deployed site + real database): visitor sees counts only and every table is closed; code-only sign-in; **A's review appears in B's browser**; author-only edit (UI + server); **self-review refused**; **course restriction both ways** (UI + server), other course still explorable; unassigned project refused; **two simultaneous submissions for the last slot: exactly one succeeds**, the full project stays explorable; pause refuses writes; no page errors. All test data was removed afterwards and checked |
| Student feedback | **PAUSED**: no codes have been handed out |

**Not tested on production:** the instructor dashboard UI itself (magic-link sign-in into your mailbox). Moderation and the
pause/resume buttons were tested only against the local stand-in.

### What you still need to do

1. **Sign in to the dashboard yourself:** the site → **Instructor** → your Fairfield e-mail → open the link. Check that the
   numbers show 86 students, 81 working sites, 344 reviews required, assignments 112 / 232. (Do **not** press Generate
   again unless the roster changes; it is already done.)
2. **Hand out the codes privately**, one per student, from `private/access_codes_2026-11-23.csv` (for example in a private
   message or on slips of paper). Never post the file. Lost code: `npm run access-codes -- --only <student id>`, then run
   the new `private/access_codes_upsert.sql` with `npx supabase db query --remote --file …` (or the SQL editor).
3. **Open feedback** when you are ready: Dashboard → **Reopen feedback** (or ask me). Students can submit only after this.
4. Optional: the privacy decision in `docs/PRIVACY_REVIEW.md` and the column-F confirmation (sections 3 and 17 above) are still open.
