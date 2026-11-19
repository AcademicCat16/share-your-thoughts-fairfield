# Fairfield Interactive World — The Feedback Classroom

A Thanksgiving peer-feedback activity for MKTG 2241 (sections 01 and 02). Students visit
**https://academiccat16.github.io/share-your-thoughts-fairfield/**, find a classmate's creature in a 3D (or 2D)
classroom, explore that classmate's interactive website, and leave one compliment and one suggestion.

Nothing to install for students. The site currently runs in **Demo Mode**: comments are stored only in the
visitor's own browser. Shared, live commenting needs the one-time Supabase setup in [`supabase/SETUP.md`](supabase/SETUP.md).

| Page | What it is |
|---|---|
| `#/` Classroom | 58 desks (28 + 30), a creature at every desk with a valid project link, search, section filter, 3D/2D views, "Find a World That Needs Feedback" |
| `#/guide` Student Guide | eight large, plain-language steps |
| `#/instructor` Instructor | counts, completion report, comments per project, reviews per student, broken links, moderation, CSV exports, roster import, demo reset (Live mode: instructor sign-in required) |

## Instructor tasks

```bash
npm install                 # once
npm run import-roster       # re-read "Take-Home Exam.xlsx" (sheet "Your Own Interactive World") → src/data/roster.json
npm run check-urls          # optional: request each valid project link once → src/data/url_check.json
git add src/data && git commit -m "Update roster" && git push   # the site redeploys itself
```

Re-importing is safe: a returning student keeps their id, seat and creature (so comments stay attached); only links
change. New students get the next seat and an unused creature. Students who disappear from the sheet are kept in
`removed` so their comments are never orphaned. The workbook itself is **never** committed (`*.xlsx` is ignored);
only names, sections and project links are published, in `src/data/roster.json`.

Live mode only (after `supabase/SETUP.md`):

```bash
npm run live-sql            # → supabase/seed/roster_upsert.sql   (paste into the Supabase SQL editor)
npm run access-codes        # → private/access_codes_<date>.csv (hand out privately) + private/access_codes_upsert.sql (hashes only)
npm run access-codes -- --only s01-03,s02-07   # replace lost codes
```

`private/` is git-ignored. Codes are never printed, never sent anywhere, and only bcrypt hashes go to the database.

## Development

```bash
npm run dev          # http://localhost:5320/share-your-thoughts-fairfield/
npm test             # unit tests: roster import, URL rules, creatures, comment wording, rules engine
npm run test:db      # live-mode SQL on a throw-away local Postgres 17 with Supabase stand-ins (incl. concurrency)
npm run build && npm run test:e2e   # 17 browser scenarios in Chrome; screenshots in tests/output/e2e/
npm run check:publish               # no workbook / codes / secret keys in the repo or the built site
```

Stack: React 19 + TypeScript + Vite; Three.js via React Three Fiber (3D view, lazy-loaded); SVG + CSS (2D view and
creatures); Supabase (Live mode only, lazy-loaded). The rules live in `shared/rules.ts` + `shared/engine.ts` (Demo) and
are mirrored in `supabase/migrations/001_feedback_classroom.sql` (Live); see `supabase/CONTRACT.md`.

See `FINAL_REPORT.md` for what is built, tested, deployed and still to do.
