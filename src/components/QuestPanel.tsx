import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, KeyRound, PartyPopper } from 'lucide-react'
import { useApp, go, PENDING_OPEN_KEY } from '../lib/app.tsx'
import { COURSES, type CourseKey } from '../../shared/roster.ts'

export const CONGRATS_TITLE = 'Congratulations, Thoughtful Explorer!'
export const CONGRATS_TEXT = "You've explored four classmates' creations and shared feedback to help them grow."
export const CONGRATS_MORE = 'Keep exploring — there are more amazing worlds to discover!'

/** "Your Feedback Quest: 2 / 4 completed" — assigned projects, progress and the next step. */
export function QuestPanel({ course, onSignIn }: { course: CourseKey; onSignIn: () => void }) {
  const { me, quest, byId, select } = useApp()
  const [open, setOpen] = useState(true)
  if (!me) {
    return (
      <section className="quest quest-out" aria-label="Your Feedback Quest">
        <p><strong>Your Feedback Quest:</strong> sign in to see the four classmates you'll review. Exploring needs no sign-in — click any creature!</p>
        <button type="button" className="btn small" onClick={onSignIn} data-testid="quest-signin"><KeyRound size={15} aria-hidden="true" /> Sign in</button>
      </section>
    )
  }
  const done = Math.min(me.completed, me.required)
  const assigned = quest.filter((q) => q.status !== 'extra')
  const other = me.course !== course
  const complete = me.completed >= me.required
  const openItem = (id: string) => {
    const s = byId.get(id)
    if (!s) return
    if (s.course === course) select(id)
    else { try { sessionStorage.setItem(PENDING_OPEN_KEY, id) } catch { /* ignore */ } go(s.course) }
  }
  return (
    <section className={`quest${complete ? ' complete' : ''}`} aria-labelledby="quest-title" data-testid="quest">
      <div className="quest-head">
        <h2 id="quest-title"><span className="quest-stars" aria-hidden="true">{Array.from({ length: me.required }, (_, i) => <i key={i} className={i < done ? 'on' : ''}>★</i>)}</span>
          <span data-testid="quest-progress">Your Feedback Quest: {done} / {me.required} completed</span></h2>
        <div className="row">
          <button type="button" className="icon-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="quest-body" aria-label={open ? 'Hide quest details' : 'Show quest details'}>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
        </div>
      </div>
      {open && (
        <div id="quest-body" className="quest-body">
          {other && <p className="hint">You're signed in as a {COURSES[me.course].code} student, so your reviews are in the {COURSES[me.course].title} classroom. You're welcome to explore this room too! <button type="button" className="linklike" onClick={() => go(me.course)}>Go to my classroom</button></p>}
          {complete && (
            <div className="congrats" data-testid="quest-congrats">
              <PartyPopper size={22} aria-hidden="true" />
              <div><strong>{CONGRATS_TITLE}</strong><p>{CONGRATS_TEXT}</p><p>{CONGRATS_MORE}</p></div>
            </div>
          )}
          {!assigned.length && !complete && <p className="hint">Your instructor hasn't handed out review assignments yet. Explore freely in the meantime!</p>}
          {assigned.length > 0 && (
            <ul className="quest-list" aria-label="Your assigned projects">
              {assigned.map((q) => {
                const s = byId.get(q.projectId)
                return (
                  <li key={q.projectId} className={q.status}>
                    <button type="button" onClick={() => openItem(q.projectId)} data-testid={`quest-item-${q.projectId}`}>
                      {q.status === 'completed' ? <Check size={15} aria-label="Done" /> : <span className="dot" aria-label="To do" />}
                      <span>{s?.fullName ?? q.projectId}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="hint small">Progress: {done} completed · {Math.max(0, me.required - done)} remaining. “Explore Another World” is for discovery — you can visit any project, as often as you like.</p>
        </div>
      )}
    </section>
  )
}
