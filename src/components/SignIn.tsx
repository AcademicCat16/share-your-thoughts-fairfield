import { useState } from 'react'
import { KeyRound, LogIn } from 'lucide-react'
import { useApp, MODE } from '../lib/app.tsx'
import { BackendError } from '../lib/backend.ts'
import { COURSES, COURSE_KEYS } from '../../shared/roster.ts'

/**
 * Live: the private access code ALONE identifies the student (checked on the server) — there is no name to pick, so
 * nobody can choose someone else's identity. Demo: pick any classmate to test as (clearly labelled).
 */
export function SignInPanel({ onDone }: { onDone?: () => void }) {
  const { backend, students, refresh, say } = useApp()
  const [who, setWho] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const live = MODE === 'live'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (live && code.replace(/[^a-z0-9]/gi, '').length !== 12) { setErr('Enter the 12-character access code from your instructor (like ABCD-EFGH-JKLM).'); return }
    if (!live && !who) { setErr('Choose a classmate first.'); return }
    setBusy(true)
    try {
      const m = await backend.signIn(live ? { code } : { studentId: who })
      await refresh(); say(`Welcome, ${m.firstName}! Your Feedback Quest is ready.`); onDone?.()
    } catch (x) { setErr(x instanceof BackendError ? x.message : 'Sign-in failed. Please try again.') } finally { setBusy(false) }
  }
  return (
    <form className="signin" onSubmit={submit} data-testid="signin-form">
      <h3><KeyRound size={20} aria-hidden="true" /> {live ? 'Sign in with your access code' : 'Who are you? (Demo)'}</h3>
      {live
        ? <p className="hint">Type the private code your instructor gave you. It tells the classroom who you are — no account or password needed. Keep it to yourself.</p>
        : <p className="hint">Demo mode has no codes: pick any classmate to test as. In the real classroom, each student signs in with a private access code.</p>}
      {live ? (
        <label className="field">
          <span>Access code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" inputMode="text" data-testid="signin-code" data-autofocus />
        </label>
      ) : (
        <label className="field">
          <span>Test as</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} data-testid="signin-who" required>
            <option value="">Choose a classmate…</option>
            {COURSE_KEYS.flatMap((c) => COURSES[c].sections.map((sec) => (
              <optgroup key={sec.key} label={`${sec.code}${c === '1101' ? ' Principles of Marketing' : ''}`}>
                {students.filter((s) => s.course === c && s.section === sec.key && !s.hidden).sort((a, b) => a.lastName.localeCompare(b.lastName)).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </optgroup>
            )))}
          </select>
        </label>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="submit" className="btn primary" disabled={busy} data-testid="signin-submit"><LogIn size={18} aria-hidden="true" /> {busy ? 'Checking…' : live ? 'Sign in' : 'Use this classmate'}</button>
    </form>
  )
}
