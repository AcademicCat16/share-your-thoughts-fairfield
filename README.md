# Fairfield Interactive Worlds

A peer-feedback activity for two Fairfield marketing classes. Students open
**https://academiccat16.github.io/share-your-thoughts-fairfield/**, choose their classroom, explore classmates' interactive
websites (as many as they like), and complete four reviews — one compliment and one suggestion each.

| Page | What it is |
|---|---|
| `#/` Home | two classroom cards: **Principles of Marketing (MKTG 1101, 28 students)** and **Digital Marketing (MKTG 2241, 58 students, sections 01 + 02 together)** |
| `#/1101`, `#/2241` | the 3D (or 2D) classroom: a desk and name tag for every student, a creature at every working project, search, section filter (2241), “Find My Next Review”, “Explore Another World”, the student's Feedback Quest |
| `#/guide` | the eight-step Student Guide |
| `#/instructor` | per-course and combined statistics, assignment plans (incl. fifth slots), release/rebalance, pause, moderation, CSV exports, link tools, roster import, privacy (Live mode: instructor sign-in required) |

Nothing to install for students. **The site runs in Demo Mode until Live mode is set up**: Demo comments live only in the
visitor's own browser. Shared commenting needs the one-time Supabase setup in [`supabase/SETUP.md`](supabase/SETUP.md).

## How reviews work

* Two separate review pools: 1101 students review 1101 projects; 2241 students (both sections) review 2241 projects.
  Anyone may *explore* any project in either room.
* Only projects whose interactive website passed the browser-level link audit can receive reviews. Missing or broken projects
  keep the desk and name tag with an empty chair.
* Every student gets **four assigned classmates** from a fair plan (`shared/allocation.ts`, max-flow): never themselves, never the
  same project twice, own course only. Each working project has four standard slots; when a course needs more reviews than
  4 × projects, extra slots are opened as evenly as possible (MKTG 2241 today: 58 × 4 = 232 reviews over 53 projects → 20 projects
  get a fifth slot). A project never receives more comments than its slots — enforced in the database, race-safe.
* A full project stays fully explorable; only “Leave Your Thoughts” is switched off.

## Instructor tasks

```bash
npm install                 # once
npm run import-roster       # re-read "Take-Home Exam (final).xlsm" (never executes macros) → src/data/roster.json, docs/ROSTER_IMPORT_REPORT.md
npm run audit-links         # open every project link in Chrome → docs/FINAL_PROJECT_LINK_AUDIT.md (only "working" links can be reviewed)
git add src/data docs && git commit -m "Update roster" && git push   # the site re-tests and redeploys itself
```

Re-importing is safe: a returning student keeps their id, seat and creature (comments stay attached); a changed link is
“unchecked” until the next audit. The workbook is **never** committed. See [`docs/PRIVACY_REVIEW.md`](docs/PRIVACY_REVIEW.md) for
exactly what is public and how to hide a student.

Live mode only (after `supabase/SETUP.md`):

```bash
npm run live-sql            # → supabase/seed/roster_upsert.sql (paste into the Supabase SQL editor)
npm run access-codes        # → private/access_codes_<date>.csv (hand out privately) + private/access_codes_upsert.sql (hashes only)
npm run access-codes -- --only s01-03,pm-07   # replace lost codes
```

## Development

```bash
npm run dev          # http://localhost:5320/share-your-thoughts-fairfield/
npm run lint
npm test             # unit tests: roster import, link rules, allocation, creatures, wording, rules engine
npm run test:db      # Live-mode SQL on a throw-away local Postgres 17 with Supabase stand-ins (incl. concurrency)
npm run build && npm run test:e2e              # Demo-mode browser scenarios (E2E_CHANNEL=chrome|msedge|firefox|webkit)
npm run test:live    # Live-mode: production build in Chrome + Edge against the real SQL on a local stand-in server
npm run check:publish                          # no workbook / codes / hashes / secret keys in the repo or the built site
```

Stack: React 19 + TypeScript + Vite; Three.js via React Three Fiber (3D, lazy-loaded); SVG + CSS (2D and creatures);
Supabase (Live mode only, lazy-loaded). Rules: `shared/rules.ts`, `shared/engine.ts`, `shared/allocation.ts` (Demo) mirrored in
`supabase/migrations/001_feedback_classroom.sql` (Live) — contract in `supabase/CONTRACT.md`.

See `FINAL_REPORT.md` for what is built, tested, deployed and still to do. Rollback: tag `v1-demo-2026-11-19` is the first demo.
