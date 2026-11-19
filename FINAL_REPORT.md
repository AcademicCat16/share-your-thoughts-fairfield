# The Feedback Classroom — final report

Status words used below: **Built** (code exists) · **Tested** (an automated test or a looked-at screenshot exercised it) ·
**Deployed** (verified on the public URL) · **Demo-only** · **Requires configuration** · **Not implemented**.

## 1. Students imported — 58

28 in MKTG 2241-01 and 30 in MKTG 2241-02, read from the workbook's second worksheet "Your Own Interactive World".
The count check passed. Names are kept exactly as written in the sheet (for example *O'Leary*, *Van Wickler*, and
*John* / *Paul Hayden*, which the sheet splits that way). Ids are deterministic, `s<section>-<position>` (e.g. `s01-07`),
and are never reused.

## 2. Valid project URLs — 35

18 in Section 01 and 17 in Section 02. Whitespace was trimmed from 9 links; nothing else was changed. On 2026-11-19,
`npm run check-urls` requested each of the 35 once and all 35 answered with a success status.

## 3. Missing or invalid URLs — 23

* **22 missing**: no link in the sheet. The chair is empty; the desk and name tag are shown.
* **1 invalid**: Ava Goldberg (`s02-03`) submitted a `file:///Users/…` link. It points to a file on her own computer,
  so it is treated as not working: empty chair, no project button. No replacement link was invented.

## 4. Classroom seats — 58

28 + 30, in two labelled sections of six desks per row. Section 01's last row has 4 desks, centred.

## 5. Creatures — 58 unique

There are 58 original mascots, 5 or 6 in each of 10 categories. Each has its own name, personality, ability,
description, appearance, idle animation and hover move. A test checks that names, colours, body/ears/tail/accessory
combinations and idle animations are all unique.

* All 58 students have a creature assigned, so a creature never changes when a link arrives later.
* **35 creatures are visible**, one at each desk with a valid link.
* Assignment is fixed. The initial hand-out order is seeded, and the import script keeps every existing assignment.
  A test re-imports a reversed sheet with a new student and confirms no assignment changes.

No official Pokémon (or other franchise) artwork, names, designs or sprites were used.

## 6. Visualizations

| Item | Status |
|---|---|
| **3D classroom** (Three.js / React Three Fiber, loaded only when 3D is opened) | Built · Tested |
| ↳ room details: daylight, big windows with sunbeams, bunting, Thanksgiving touches, section rugs and floor labels | |
| ↳ camera: rotate (drag or button), zoom (wheel or button), pan (right-drag or two fingers), reset, smooth fly-to on search or selection | |
| ↳ hover: tooltip, highlight ring, creature hover moves (wave, raise hand, bounce, sparkle, spin, float) plus small elemental particles | |
| **2D classroom**: the accessible fallback and phone default; every desk is a labelled button | Built · Tested |
| **Folded desk name plates** in both views (first name, last name, small section) | Built · Tested: no overlap or clipping at 1440, 1024 and 390 px |
| Profile modal; Leave Your Thoughts form → preview → celebration | Built · Tested |
| Welcome animation, floating title, falling leaves | Built · Tested |
| Progress ring "Your reviews: n / 4" | Built · Tested |
| Instructor charts | Built · Tested |
| Optional ambient sound, synthesised and **off by default** | Built · not checked by ear |
| Reduced motion: idle and hover animation off, camera jumps instead of flying | Built · Tested (2D CSS) |

## 7. Commenting mode active — **Demo Mode**

The site shows a permanent banner: **"Demo Mode — Comments are stored only in this browser."** Comments live in that
browser's localStorage and are not shared. Live mode is prepared but **not enabled**. The site cannot switch to it
silently: it needs `VITE_FEEDBACK_MODE=live` plus two Supabase variables, and if live is requested but not configured
the site stays in Demo mode and says so.

## 8. Security protections

**Built in both modes**
* The project button only appears for a re-validated http(s) URL. It opens in a new tab with
  `rel="noopener noreferrer"`.
* Student sites are never embedded (no iframes).
* Feedback text is rendered as text, never as HTML.
* The exam workbook is never committed (`*.xlsx` is git-ignored).
* `check:publish` runs in CI and fails the build if a workbook, access-code sheet, bcrypt hash, or Supabase
  secret/service-role key appears in the repo or the built site.

**Live mode: built and tested on local Postgres 17, not yet on Supabase**
* Students sign in with their name plus a private instructor-issued access code (10 characters).
  * Only bcrypt hashes are stored. No function ever returns a code or hash.
  * Codes are never shown in comments.
  * A typed name is never trusted: the reviewer's name is copied from the roster on the server.
  * 5 wrong tries lock that student's sign-in for 15 minutes.
* Database lockdown:
  * Every table has row-level security with **no** policies, and all table privileges are revoked from
    `anon`/`authenticated`.
  * Anonymous users can call exactly one function, which returns comment counts only.
  * Every write goes through `SECURITY DEFINER` functions.
* Rules enforced on the server:
  * no self-review;
  * one comment per reviewer per project;
  * at most 4 comments per project;
  * at most 4 reviews per reviewer;
  * only the author can edit, and identity fields never change;
  * text length and kind-language rules;
  * rate limits of 15 s between writes and 20 per hour;
  * a feedback open/closed switch.
* Race safety: `submit_comment` locks the project and reviewer rows in a fixed order. Tests fire 10 simultaneous
  4th-comment attempts, and exactly 1 succeeds.
* Instructor moderation:
  * Remove and restore comments, with an audit log.
  * Protected by email sign-in plus an `instructors` table; anonymous sessions are refused.
* Access codes are generated locally into git-ignored `private/` and handed out by you. Nothing is sent
  automatically.

## 9. Test results (2026-11-19, Windows 11, Chrome)

| Suite | Result | What it covers |
|---|---|---|
| `npm test` (unit) | **21 / 21 pass** | Spreadsheet → roster (names and links match the workbook cell by cell); URL rules; 58 seats and 28/30; stable ids and creatures through re-import; creature uniqueness; comment wording; self, duplicate and capacity rules; editing; fair recommendation; completion maths |
| `npm run test:db` | **32 / 32 pass** | Live-mode SQL on a throw-away **local Postgres 17 with Supabase stand-ins** (roles, `auth.uid()`, `auth.jwt()`). Covers: lockdown, access codes and lockout, every submit rule, concurrent 4th-comment and reviewer-cap races, recommendation, instructor gating, migration re-run. **Not run against a real Supabase project.** |
| `npm run test:e2e` | **17 / 17 pass** | Real Chrome against the production build; see the list below |
| `npm run check:publish` | **pass** | 105 files scanned |

The 17 end-to-end scenarios:
* welcome screen and banner;
* exactly 58 seats with every name and section checked;
* name tags never overlap (3 screen widths);
* 23 empty seats with "This project hasn't arrived yet!" and no feedback button;
* profile modal with a validated new-tab link and no iframes;
* sign-in, validation, preview wording, submit and progress 1 / 4;
* self-review blocked, duplicate becomes edit, editing keeps the slot, other reviewers cannot edit;
* 4-comment limit and full message;
* recommendation never picks your own, a reviewed, a full or an empty desk, and 8 reviewers got 8 different desks;
* search and section filter;
* keyboard (Tab, Enter, focus trap, Esc returns focus);
* reduced motion;
* phone at 390 × 844 (no sideways scroll, 3 desks per row, modal fits);
* 3D: 58 seats and 35 creatures, zoom, rotate buttons, mouse-drag rotate, wheel zoom, right-drag pan, reset,
  hover tooltip on the right creature, click opens the right profile;
* instructor counts, shortfall text, both CSV exports, moderation, demo reset, workbook re-import preview
  (0 changes);
* Student Guide;
* no console or page errors.

I also looked at the screenshots: welcome, 2D, 3D overview, 3D zoom/hover, modal, preview, full desk, phone,
dashboard. That inspection found and fixed 5 problems the tests had missed:
1. Creature tails rendered in the wrong place.
2. The close button covered the comment counter.
3. 3D click boxes picked the desk in front from low camera angles.
4. Empty-seat cards looked as if they belonged to the next row.
5. Creatures were too small in 3D.

**Not tested**
* Firefox and Safari.
* Real phones and tablets (phone layout was tested with Chrome's mobile emulation only).
* A screen reader (labels exist but were not listened to).
* Frame rate on a weak laptop. 3D rendered in software (SwiftShader) without errors; about 470–1,000 draw calls
  depending on the view.
* The Live-mode browser code (`src/lib/liveBackend.ts`) has **never talked to a real server**.
* Two-browser shared persistence. That needs Live mode.

## 10. GitHub commit and deployment status

* Repository: https://github.com/AcademicCat16/share-your-thoughts-fairfield (was empty; first push).
* Commit: `0d6243c` on `main`.
* Workflow: `.github/workflows/deploy.yml` runs the unit, database and browser tests, the build and the safety
  check, then deploys to Pages.
* CI and deployment result: **DEPLOY_STATUS_PLACEHOLDER**

## 11. Verified public URL

PUBLIC_URL_PLACEHOLDER

## 12. Remaining steps before live classroom use

1. **Decide about review capacity.** There are 35 projects × 4 = **140 review slots**, but 58 students × 4 = **232
   reviews**. So **92 reviews cannot happen** even with full participation, and most students cannot reach 4 written
   unless more projects arrive. Options:
   * chase the 22 missing projects and Ava's local-only link;
   * accept about 2–3 reviews per student;
   * raise the per-project limit (it is a setting).

   The dashboard recalculates this live.
2. **Privacy decision.** The public site (marked `noindex`) and the public repo contain the 58 names and project links.
   Visitors who aren't signed in can't read comments in Live mode, but the roster itself is public. Consider whether
   that is acceptable, or make the repository private (GitHub Pages on a private repo needs a paid plan).
3. **To use Live mode**, follow `supabase/SETUP.md`:
   * create a free Supabase project;
   * run the migration;
   * enable Anonymous and Email sign-in;
   * add your email to `instructors`;
   * run `npm run live-sql` and `npm run access-codes`, paste both SQL files, and hand out the codes privately;
   * set the three repository variables.

   Then **test before telling students**:
   * two different browsers or devices see the same comments;
   * a wrong code is refused;
   * a 5th comment is refused;
   * the instructor dashboard and moderation work.

   This has not been done, so Live mode must not be considered working until it is.
4. Known Live-mode limitation: anyone who knows a student's id (visible in the page code) can trigger that student's
   15-minute lock with 5 wrong codes. Low risk in a class, but tell students to report a lock. You can reset it with
   `npm run access-codes -- --only <id>`.
5. Before the activity, try it once on a typical student laptop, a phone, and Safari.

**Design choices you may want to change**
* Reviewers are limited to 4 reviews written. The brief sets 4 as a target; I made it a cap so the scarce slots are
  shared.
* The kind-language filter is a short word list. It is a speed bump, not moderation.
* Comments are rephrased by fixed rules, not AI. If an answer can't be rephrased safely, it is shown word for word
  after "What *Name* enjoyed most:" or "One idea to make it even better:".
