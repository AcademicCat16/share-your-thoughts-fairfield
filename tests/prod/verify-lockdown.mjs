/**
 * READ-ONLY security check of the linked production Supabase database (npm run verify:prod-lockdown).
 * Runs catalog queries through `supabase db query --remote --read-only`; never writes anything.
 * Every check is a query whose rows are VIOLATIONS: an empty result means the check passed.
 * Mirrors assertLockedDown() in tests/db/live.test.ts.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TABLES = ['settings', 'students', 'access_codes', 'code_attempts', 'student_sessions', 'project_slots', 'assignments',
  'comments', 'write_events', 'instructors', 'audit_log', 'blocked_terms', 'source_events']
const ANON = ['get_public_status', 'get_feedback_open', 'get_public_settings',
  'get_project_comments', 'get_student_quest', 'submit_feedback', 'edit_feedback'] // + migration 002 (honor system)
const AUTH = [...ANON, 'redeem_access_code', 'whoami', 'sign_out_student', 'my_quest', 'next_review',
  'get_comments', 'my_reviews', 'submit_comment', 'update_comment', 'is_instructor', 'admin_overview',
  'admin_apply_assignments', 'admin_set_participating', 'admin_remove_comment', 'admin_restore_comment', 'admin_set_open',
  'admin_set_allow_extra']
// Supabase's own "enable RLS automatically" event-trigger helper (created with the project, not by our migration).
// It is excluded from the app-function checks; its own check requires EXECUTE revoked from anon/authenticated/PUBLIC.
const PLATFORM_FUNCTIONS = ['rls_auto_enable']

const lit = (xs) => `array[${xs.map((x) => `'${x}'`).join(',')}]::text[]`
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const tmp = mkdtempSync(join(tmpdir(), 'fic-verify-'))
let n = 0
function query(sql) {
  const file = join(tmp, `q${++n}.sql`)
  writeFileSync(file, sql)
  const r = spawnSync(npx, ['supabase', 'db', 'query', '--remote', '--read-only', '--file', `"${file}"`], { encoding: 'utf8', shell: process.platform === 'win32', input: '' })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const so = r.stdout ?? ''
  let j
  try { j = JSON.parse(so.slice(so.indexOf('{'), so.lastIndexOf('}') + 1)) } catch { throw new Error(`could not parse CLI output:\n${out.slice(0, 500)}`) }
  if (j._tag === 'Error' || !Array.isArray(j.rows)) throw new Error(`query failed: ${JSON.stringify(j.error ?? j).slice(0, 400)}`)
  return j.rows
}

const one = (s) => s.replace(/\s+/g, ' ').trim()
const checks = [
  ['the 13 app tables exist (missing ones listed)', `select t as missing from unnest(${lit(TABLES)}) t
     where not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=t)`],
  ['no unexpected tables in public', `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','v','m','f','p') and not (c.relname = any(${lit(TABLES)}))`],
  ['row-level security is ON for every public table', `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`],
  ['no RLS policies in public (all access goes through functions)', `select tablename, policyname from pg_policies where schemaname='public'`],
  ['anon / authenticated / PUBLIC have NO table privileges', `select c.relname, r.rolname, p.priv from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join (select rolname from pg_roles where rolname in ('anon','authenticated')) r
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
     where n.nspname='public' and c.relkind in ('r','v','m') and has_table_privilege(r.rolname, c.oid, p.priv)
     union all
     select c.relname, 'PUBLIC', a.privilege_type from pg_class c join pg_namespace n on n.oid=c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where n.nspname='public' and c.relkind in ('r','v','m') and a.grantee = 0`],
  ['no column-level grants to anon / authenticated', `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
     where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')`],
  ['no sequence privileges for anon / authenticated', `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='S' and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))`],
  ['all expected app functions exist', `select f as missing from unnest(${lit(AUTH)}) f
     where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f)`],
  ['anon may execute ONLY the public functions (3 status + 4 honor-system)', `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and not (p.proname = any(${lit(PLATFORM_FUNCTIONS)}))
       and has_function_privilege('anon', p.oid, 'execute') <> (p.proname = any(${lit(ANON)}))`],
  ['authenticated may execute ONLY the app RPCs (no internal _helpers)', `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and not (p.proname = any(${lit(PLATFORM_FUNCTIONS)}))
       and has_function_privilege('authenticated', p.oid, 'execute') <> (p.proname = any(${lit(AUTH)}))`],
  ['no function is executable by PUBLIC', `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname='public' and not (p.proname = any(${lit(PLATFORM_FUNCTIONS)})) and a.grantee = 0 and a.privilege_type='EXECUTE'`],
  ['every app function is SECURITY DEFINER with a pinned search_path', `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and not (p.proname = any(${lit(PLATFORM_FUNCTIONS)}))
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=public, extensions, pg_temp'])`],
  ['exactly one redeem_access_code (the v2 code-only version)', `select count(*) as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='redeem_access_code' having count(*) <> 1 or min(pg_get_function_identity_arguments(p.oid)) <> 'p_code text'`],
  ['feedback is PAUSED until the production checks are complete', `select feedback_open from public.settings where id = 1 and feedback_open`],
  ["Supabase's rls_auto_enable helper is not executable by anon / authenticated / PUBLIC", `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname = any(${lit(PLATFORM_FUNCTIONS)})
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
            or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))`],
  ['access codes stored as SHA-256 hex only', `select student_id from public.access_codes where code_hash !~ '^[0-9a-f]{64}$'`],
  ['edit tokens stored as SHA-256 hex only', `select id from public.comments where edit_token_hash is not null and edit_token_hash !~ '^[0-9a-f]{64}$'`],
  ['source_events holds only hashed sources', `select id from public.source_events where source_hash !~ '^[0-9a-f]{64}$'`],
  ['no access-code PLAINTEXT column exists (hashes only)', `select column_name from information_schema.columns where table_schema='public' and table_name='access_codes' and column_name not in ('student_id','code_hash','created_at','revoked_at')`],
]

let failed = 0
for (const [name, sql] of checks) {
  try {
    const rows = query(one(sql))
    if (rows.length === 0) console.log(`  ✔ ${name}`)
    else { failed++; console.log(`  ✖ ${name}\n      ${JSON.stringify(rows).slice(0, 600)}`) }
  } catch (e) { failed++; console.log(`  ✖ ${name}\n      ${e.message}`) }
}
const plat = query(one(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec, pg_get_function_result(p.oid) returns
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any(${lit(PLATFORM_FUNCTIONS)})`))
for (const r of plat) console.log(`  ℹ platform function ${r.proname} (returns ${r.returns}; not callable directly): trigger kept, direct EXECUTE revoked`)
console.log(failed ? `\n${failed} of ${checks.length} production lock-down checks FAILED.` : `\nAll ${checks.length} production lock-down checks passed.`)
rmSync(tmp, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
