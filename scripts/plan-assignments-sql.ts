/**
 * Instructor helper: compute each course's reviewer-assignment plan with the SAME planner the dashboard's
 * "Generate reviewer assignments" button uses (shared/engine.ts planCourse, mode "replace"), and write a SQL file that
 * applies it through the server's own validation (public.admin_apply_assignments), acting as the instructor.
 *
 *   node scripts/plan-assignments-sql.ts --instructor-email you@school.edu --instructor-uid <auth user id>
 *
 * Use only on an EMPTY assignments/comments state (first set-up); afterwards use the dashboard, which also accounts for
 * finished reviews. Output goes to the git-ignored private/ folder: private/assignments_apply.sql (plus a summary).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyState, planCourse, DEFAULT_SETTINGS } from '../shared/engine.ts'
import type { Roster } from '../shared/roster.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const email = arg('--instructor-email')
const uid = arg('--instructor-uid')
if (!email || !/^[^@\s']+@[^@\s']+$/.test(email) || !uid || !/^[0-9a-f-]{36}$/i.test(uid)) {
  console.error('usage: --instructor-email <email> --instructor-uid <uuid>'); process.exit(2)
}
const roster = JSON.parse(readFileSync(path.join(ROOT, 'src', 'data', 'roster.json'), 'utf8')) as Roster
const day = new Date().toISOString().slice(0, 10)
const claims = JSON.stringify({ sub: uid, email, role: 'authenticated', aud: 'authenticated', is_anonymous: false })
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

const out: string[] = [
  `-- Reviewer assignments generated ${new Date().toISOString()} with planCourse(mode "replace", seed "fic-<course>-${day}").`,
  '-- Applied through public.admin_apply_assignments, which re-validates the whole plan; runs as the instructor.',
  'begin;',
  `select set_config('request.jwt.claims', ${q(claims)}, true);`,
  `select set_config('request.jwt.claim.sub', ${q(uid)}, true);`,
  `select set_config('request.jwt.claim.email', ${q(email)}, true);`,
  'set local role authenticated;',
]
const summary: string[] = []
for (const course of ['1101', '2241'] as const) {
  const plan = planCourse(emptyState(), roster.students, course, 'replace', DEFAULT_SETTINGS, `fic-${course}-${day}`)
  if (!plan.ok) { console.error(`${course}: plan not feasible: ${plan.problems.join('; ')}`); process.exit(1) }
  const edges = plan.assignments.filter((a) => a.status === 'pending').map((a) => ({ reviewer_id: a.reviewerId, project_id: a.projectId }))
  const reviewers = new Set(edges.map((e) => e.reviewer_id))
  out.push(`select '${course}' as course, * from public.admin_apply_assignments('${course}', ${q(JSON.stringify(plan.capacities))}::jsonb, ${q(JSON.stringify(edges))}::jsonb);`)
  summary.push(`${course}: ${edges.length} assignments for ${reviewers.size} reviewers over ${Object.keys(plan.capacities).length} projects; ` +
    `${plan.projectsWithExtra} projects with a fifth slot (extra slots ${plan.extraSlots}); demand ${plan.demand}, standard capacity ${plan.standardCapacity}`)
}
out.push('commit;', '')
mkdirSync(path.join(ROOT, 'private'), { recursive: true })
writeFileSync(path.join(ROOT, 'private', 'assignments_apply.sql'), out.join('\n'))
console.log(summary.join('\n'))
console.log('Wrote private/assignments_apply.sql (git-ignored). Nothing was uploaded.')
