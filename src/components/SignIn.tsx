import { useState } from 'react'
import { UserRound, LogIn } from 'lucide-react'
import { useApp, MODE } from '../lib/app.tsx'
import { BackendError } from '../lib/backend.ts'
import { COURSES, COURSE_KEYS } from '../../shared/roster.ts'

/** Honor-system note shown wherever a student picks a name (Live and Demo). */
export const HONOR_NOTE = 'Honor system: choose only your own name. The classroom trusts this choice — it does not check who you are.'

/**
 * Choose your name (HONOR SYSTEM). This only remembers the choice in this browser so your Feedback Quest can be shown;
 * nothing is verified. Every review is checked on the server for the name it is sent under.
 */
export function SignInPanel({ onDone }: { onDone?: () => void }) {
  const { backend, students, refresh, say } = useApp()
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!who) { setErr('Choose your name first.'); return }
    setBusy(true)
    try {
      const m = await backend.signIn({ studentId: who })
      await refresh(); say(`Welcome, ${m.firstName}! Your Feedback Quest is ready.`); onDone?.()
    } catch (x) { setErr(x instanceof BackendError ? x.message : 'Something went wrong. Please try again.') } finally { setBusy(false) }
  }
  return (
    <form className="signin" onSubmit={submit} data-testid="signin-form">
      <h3><UserRound size={20} aria-hidden="true" /> {MODE === 'live' ? 'Who are you?' : 'Who are you? (Demo)'}</h3>
      <p className="hint">Pick your name to see your Feedback Quest — the four classmates you'll review. No account or password needed.</p>
      <p className="hint honor-note" data-testid="honor-note">{HONOR_NOTE}</p>
      <label className="field">
        <span>Your name</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} data-testid="signin-who" required data-autofocus>
          <option value="">Choose your name…</option>
          {COURSE_KEYS.flatMap((c) => COURSES[c].sections.map((sec) => (
            <optgroup key={sec.key} label={`${sec.code}${c === '1101' ? ' Principles of Marketing' : ' Digital Marketing'}`}>
              {students.filter((s) => s.course === c && s.section === sec.key && !s.hidden).sort((a, b) => a.lastName.localeCompare(b.lastName)).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </optgroup>
          )))}
        </select>
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="submit" className="btn primary" disabled={busy} data-testid="signin-submit"><LogIn size={18} aria-hidden="true" /> {busy ? 'One moment…' : "That's me"}</button>
    </form>
  )
}
