import { useState } from 'react'
import { KeyRound, LogIn } from 'lucide-react'
import { useApp, MODE } from '../lib/app.tsx'
import { BackendError } from '../lib/backend.ts'

/** Demo: choose which classmate you are pretending to be. Live: your name + the private access code from your instructor. */
export function SignInPanel({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { backend, students, refresh, say } = useApp()
  const [who, setWho] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const live = MODE === 'live'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (!who) { setErr('Choose your name first.'); return }
    if (live && code.replace(/[^a-z0-9]/gi, '').length < 10) { setErr('Enter the 10-character access code from your instructor.'); return }
    setBusy(true)
    try { const m = await backend.signIn(who, code); await refresh(); say(`Welcome, ${m.fullName}!`); onDone?.() } catch (x) { setErr(x instanceof BackendError ? x.message : 'Sign-in failed. Please try again.') } finally { setBusy(false) }
  }
  return (
    <form className={`signin${compact ? ' compact' : ''}`} onSubmit={submit} data-testid="signin-form">
      <h3><KeyRound size={20} aria-hidden="true" /> {live ? 'Sign in to leave feedback' : 'Who are you? (Demo)'}</h3>
      {live
        ? <p className="hint">Use the private access code your instructor gave you. Your typed name is never used as proof of who you are — the code is.</p>
        : <p className="hint">Demo mode has no passwords: pick any classmate to test as. In the real classroom, each student signs in with a private access code.</p>}
      <label className="field">
        <span>Your name</span>
        <select value={who} onChange={(e) => setWho(e.target.value)} data-testid="signin-who" required>
          <option value="">Choose your name…</option>
          {(['01', '02'] as const).map((sec) => (
            <optgroup key={sec} label={`MKTG 2241-${sec}`}>
              {students.filter((s) => s.section === sec).sort((a, b) => a.lastName.localeCompare(b.lastName)).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {live && (
        <label className="field">
          <span>Access code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" data-testid="signin-code" />
        </label>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="submit" className="btn primary" disabled={busy} data-testid="signin-submit"><LogIn size={18} aria-hidden="true" /> {busy ? 'Checking…' : live ? 'Sign in' : 'Use this classmate'}</button>
    </form>
  )
}
