# Public roster visibility — instructor review

**Please read this before sharing the website link with students.** The site is public: anyone who has the link can open
it. (It asks search engines not to list it, but that is a request, not a lock.) The source repository on GitHub is public too.

## What anyone with the link can see

For each of the 86 students (MKTG 1101 and MKTG 2241):

| Shown | Where it comes from |
|---|---|
| First and last name, as written in the workbook | `src/data/roster.json` |
| Course and section (e.g. `MKTG 2241-02`) | same |
| Their **interactive** project link (1101: column E; 2241: column E, or F when F holds the published site) | same |
| Which workbook cell the link came from, and the link-check result (working / broken, page title, any JavaScript errors seen) | `src/data/roster.json`, `src/data/link_audit.json` |
| The creature assigned to their desk | same |
| How many feedback slots a project has and how many are used (numbers only) | Live database, `get_public_status` |

## What is NOT published

* Email addresses, grades, the workbook itself or any other workbook column. **MKTG 1101 column D (personal websites) is never read
  into the roster.** A check in the publish step fails the build if a workbook (`.xlsx`, `.xlsm`, `.xls`, `.xlsb`) is ever committed.
* Access codes and code hashes. Codes are generated into the git-ignored `private/` folder on your computer only; the publish check
  also fails if anything shaped like an access code, an access-code sheet, a hash upload or a Supabase secret key appears in the
  repository or the built site.
* Comments. In Live mode, comments can be read only by signed-in students and by you. Visitors who are not signed in see counts only.
  (In Demo mode comments exist only in the browser where they were typed.)
* Reviewer assignments (who reviews whom). Each student sees only their own list after signing in.

## Hiding a student

If a student should not appear in the public gallery:

1. Dashboard → **Public roster visibility** → tick the student → **Download visibility.json**
   (or edit `src/data/visibility.json` by hand: `{ "hidden": ["s02-07"] }`).
2. Put the file in `src/data/`, run `npm run import-roster`, commit and push.

Their desk stays in the room as a **Reserved seat** with no name, link or creature, and they cannot receive reviews. Their full
details are kept only in `private/roster_full.json` on your computer (used for Live-mode sign-in). In Live mode, run
`npm run live-sql` again afterwards so the database also marks them hidden.

## Decision needed from you

* Is it acceptable for the names and project links of all 86 students to be visible to anyone who has the link? If not, either hide
  individual students as above, or make the repository private (GitHub Pages from a private repository needs a paid GitHub plan).
