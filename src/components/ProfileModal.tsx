import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, MessageCircleHeart, PencilLine, Sparkles, Eye, ArrowLeft, Send, Shuffle, Compass, PartyPopper } from 'lucide-react'
import { isReviewable, unavailableReason, type Student } from '../../shared/roster.ts'
import { composeComment } from '../../shared/compose.ts'
import { BASE_SLOTS, PRONOUNS_MAX, TEXT_MAX, TEXT_MIN, validateFeedback, RULE_MESSAGES, type RuleError } from '../../shared/rules.ts'
import { CREATURE_BY_ID, useApp, slotsOf, markExplored } from '../lib/app.tsx'
import { BackendError, type CommentView } from '../lib/backend.ts'
import { Modal } from './Modal.tsx'
import { CreatureSvg } from './CreatureSvg.tsx'
import { HONOR_NOTE } from './SignIn.tsx'
import type { QuestItem } from '../../shared/engine.ts'
import { COURSES } from '../../shared/roster.ts'
import { Celebrate } from './Celebrate.tsx'
import { SlotDots } from './Classroom2D.tsx'
import { CONGRATS_TITLE, CONGRATS_TEXT, CONGRATS_MORE } from './QuestPanel.tsx'

export const FULL_TITLE = 'All comment slots are full!'
export const FULL_TEXT = 'This project has received its feedback for now. You can still explore the website and read what your classmates shared!'
export const FORM_TITLE = 'Leave Your Thoughts'
export const FORM_SUBTITLE = 'Tell your classmate what you loved and share one idea that could make it even better!'
export const Q1 = 'What did you enjoy most about this project? Share a specific compliment!'
export const Q2 = 'What is one improvement or new feature you would suggest?'

/** Only https/http links that parse are ever turned into a button. */
export function safeProjectUrl(s: Student): string | null {
  if (!isReviewable(s)) return null
  try { const u = new URL(s.url!); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null }
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function CommentCard({ c, mine, onEdit }: { c: CommentView; mine: boolean; onEdit?: () => void }) {
  return (
    <li className={`comment${mine ? ' mine' : ''}`} data-testid="comment">
      <div className="comment-head">
        <strong>{c.reviewerName}</strong>
        {c.pronouns && <span className="pronouns">({c.pronouns})</span>}
        <time dateTime={c.createdAt}>{fmtDate(c.createdAt)}{c.updatedAt !== c.createdAt ? ' · edited' : ''}</time>
      </div>
      <p>{composeComment({ reviewerName: c.reviewerName, pronouns: c.pronouns, enjoyed: c.enjoyed, suggestion: c.suggestion })}</p>
      {mine && onEdit && <button type="button" className="btn small ghost" onClick={onEdit} data-testid="edit-comment"><PencilLine size={15} aria-hidden="true" /> Edit my comment</button>}
    </li>
  )
}

const UNAVAILABLE: Record<string, string> = {
  missing: "This project hasn't arrived yet!",
  invalid: "This project's link can't be opened by classmates yet.",
  broken: "This project's website isn't loading right now.",
  unchecked: "This project's link is waiting to be checked.",
  hidden: 'This seat is reserved.',
}

type Step = 'profile' | 'form' | 'preview' | 'done'

export function ProfileModal({ student, onClose, onExploreAnother, onFindNext }: { student: Student; onClose: () => void; onExploreAnother: () => void; onFindNext: () => void }) {
  const { backend, me, status, quest, refresh, reducedMotion, students } = useApp()
  const spec = CREATURE_BY_ID.get(student.creatureId)
  const url = safeProjectUrl(student)
  const [comments, setComments] = useState<CommentView[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('profile')
  const [editing, setEditing] = useState<CommentView | null>(null)
  const [form, setForm] = useState({ pronouns: '', enjoyed: '', suggestion: '' })
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<CommentView | null>(null)
  /** The name chosen in the form (honor system) and that name's Feedback Quest (null while loading). */
  const [reviewerId, setReviewerId] = useState('')
  const [selQuest, setSelQuest] = useState<QuestItem[] | null>(null)
  useEffect(() => {
    let live = true
    setSelQuest(null)
    if (reviewerId) backend.questOf(reviewerId).then((q) => { if (live) setSelQuest(q) }).catch(() => { if (live) setSelQuest([]) })
    return () => { live = false }
  }, [backend, reviewerId])

  const load = useCallback(async () => {
    try { setComments(await backend.comments(student.id)); setLoadErr(null) } catch (e) { setLoadErr(e instanceof BackendError ? e.message : 'Could not load comments.') }
  }, [backend, student.id])
  useEffect(() => { if (url) load() }, [load, url, me?.studentId])

  if (!url || !spec) {
    const reason = unavailableReason(student) ?? 'missing'
    return (
      <Modal title={student.hidden ? 'Reserved seat' : `${student.fullName}'s desk`} onClose={onClose} className="profile empty-profile" testId="profile-modal">
        <div className="empty-hero" aria-hidden="true"><span className="empty-chair big"><span className="chair-back" /></span><span className="floating-envelope">✉</span></div>
        <h2 className="profile-name">{student.hidden ? 'Reserved seat' : student.fullName}</h2>
        <p className="section-chip">{student.sectionCode}</p>
        <p className="empty-message" data-testid="empty-message">{UNAVAILABLE[reason]}</p>
        {!student.hidden && <p className="hint">The chair stays empty until the project is ready, so it can't receive reviews yet. {me?.studentId === student.id ? "You can still review your classmates' worlds!" : 'There are plenty of other worlds to explore!'}</p>}
        <div className="row center">
          <button type="button" className="btn" onClick={onExploreAnother} data-testid="modal-explore-another"><Shuffle size={16} aria-hidden="true" /> Explore Another World</button>
          <button type="button" className="btn primary" onClick={onClose}>Back to the classroom</button>
        </div>
      </Modal>
    )
  }

  const sl = slotsOf(status, student.id)
  const published = comments ? comments.length : sl.published
  const capacity = Math.max(sl.capacity, published)
  const full = published >= capacity
  const mineHere = comments?.find((c) => c.reviewerId === me?.studentId) ?? null
  const isSelf = me?.studentId === student.id
  const pendingHere = quest.some((q) => q.projectId === student.id && q.status === 'pending')
  const questDone = !!me && me.completed >= me.required
  /** Why the button is off, computed for display only — the server decides for real. */
  const blocker: RuleError | 'paused' | null = !me ? (!status.open ? 'paused' : full ? 'project_full' : null)
    : !status.open ? 'paused'
      : isSelf ? 'self_review'
        : me.course !== student.course ? 'wrong_course'
          : mineHere ? 'already_reviewed'
            : full ? 'project_full'
              : !pendingHere && !(questDone && status.allowExtra) ? 'not_assigned'
                : null

  const startForm = (edit: CommentView | null) => {
    setErr(null); setEditing(edit)
    setForm(edit ? { pronouns: edit.pronouns ?? '', enjoyed: edit.enjoyed, suggestion: edit.suggestion } : { pronouns: form.pronouns, enjoyed: '', suggestion: '' })
    setReviewerId(edit ? edit.reviewerId : me && me.course === student.course && me.studentId !== student.id ? me.studentId : '')
    setStep('form')
  }
  /** Classmates who may appear in the dropdown: same course, not the project's owner, not hidden. */
  const classmates = students.filter((s) => s.course === student.course && s.id !== student.id && !s.hidden)
  const reviewedHere = new Set((comments ?? []).map((c) => c.reviewerId))
  const selected = students.find((s) => s.id === reviewerId) ?? null
  const selDone = (selQuest ?? []).filter((q) => q.status !== 'pending').length
  /** Why the SELECTED name cannot send this review (display only; the server checks again). */
  const selBlock: RuleError | null = editing || !reviewerId ? null
    : reviewedHere.has(reviewerId) ? 'already_reviewed'
      : selQuest === null ? null
        : selQuest.some((q) => q.projectId === student.id && q.status === 'pending') ? null
          : status.allowExtra && selDone >= BASE_SLOTS ? null : 'not_assigned'
  const selBlockText = selBlock === 'not_assigned'
    ? `This world isn't on ${selected?.firstName ?? 'that student'}'s Feedback Quest list — but anyone can explore it! Use “Find My Next Review” to reach the assigned projects.`
    : selBlock ? RULE_MESSAGES[selBlock] : ''
  const toPreview = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && !reviewerId) { setErr({ msg: 'Choose your name from the list first.', field: 'reviewer' }); return }
    if (selBlock) { setErr({ msg: selBlockText, field: 'reviewer' }); return }
    const v = validateFeedback(form)
    if (!v.ok) {
      const which = v.field === 'enjoyed' ? 'Question 1' : v.field === 'suggestion' ? 'Question 2' : 'Pronouns'
      setErr({ msg: `${which}: ${v.field === 'pronouns' && v.error === 'invalid_text' ? `keep it under ${PRONOUNS_MAX} characters.` : RULE_MESSAGES[v.error]}`, field: v.field }); return
    }
    setErr(null); setStep('preview')
  }
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const c = editing ? await backend.update(editing.id, form) : await backend.submit(student.id, form, reviewerId)
      setSent(c)
      await Promise.all([load(), refresh()])
      setStep('done')
    } catch (e) {
      setErr({ msg: e instanceof BackendError ? e.message : 'Could not send your feedback. Please try again.' })
      if (e instanceof BackendError && ['project_full', 'already_reviewed', 'self_review', 'not_assigned', 'wrong_course'].includes(e.code)) { await Promise.all([load(), refresh()]); setStep('profile') }
    } finally { setBusy(false) }
  }

  const previewName = editing ? editing.reviewerName : selected?.fullName ?? ''
  const previewText = previewName ? composeComment({ reviewerName: previewName, pronouns: form.pronouns, enjoyed: form.enjoyed, suggestion: form.suggestion }) : ''
  const nowDone = !!me && me.completed >= me.required

  return (
    <Modal title={`${student.fullName}'s world`} onClose={onClose} className={`profile cat-${spec.category.toLowerCase()}`} labelledBy="profile-title" testId="profile-modal">
      {step === 'profile' && (
        <div className="profile-body">
          <div className="profile-hero">
            <div className="hero-glow" aria-hidden="true" />
            <CreatureSvg spec={spec} size={220} animate={!reducedMotion} active title={`${spec.name}, a ${spec.category} creature`} />
          </div>
          <div className="profile-info">
            <h2 id="profile-title" className="profile-name" data-testid="profile-name">{student.fullName}</h2>
            <p className="section-chip">{student.sectionCode}</p>
            <div className="creature-card">
              <h3><span data-testid="creature-name">{spec.name}</span> <span className={`type-badge cat-${spec.category.toLowerCase()}`}>{spec.category}</span></h3>
              <p className="personality">{spec.personality}</p>
              <p><strong>Ability:</strong> {spec.ability}</p>
              <p className="desc">{spec.description}</p>
            </div>
            <a className="btn primary explore" href={url} target="_blank" rel="noopener noreferrer" data-testid="explore-link" onClick={() => markExplored(student.id)}>
              <ExternalLink size={18} aria-hidden="true" /> Explore This World
            </a>
            <p className="url-line" title={url}><span className="url-text">{url.replace(/^https?:\/\//, '')}</span> <span className="hint nowrap">(opens in a new tab)</span></p>
            <div className="row">
              <button type="button" className="btn small" onClick={onExploreAnother} data-testid="modal-explore-another"><Shuffle size={15} aria-hidden="true" /> Explore Another World</button>
              {me && !nowDone && <button type="button" className="btn small ghost" onClick={onFindNext} data-testid="modal-find-next"><Compass size={15} aria-hidden="true" /> Find My Next Review</button>}
            </div>
          </div>
          <div className="profile-comments">
            <h3><MessageCircleHeart size={20} aria-hidden="true" /> Peer thoughts <span className="count-pill" data-testid="comment-count" title={`${capacity - BASE_SLOTS > 0 ? `${BASE_SLOTS} standard + ${capacity - BASE_SLOTS} additional slot(s)` : `${BASE_SLOTS} standard slots`}`}>{published} / {capacity}</span></h3>
            <p className="slots-line"><SlotDots published={published} capacity={capacity} className="big" /> <span className="hint">{capacity > BASE_SLOTS ? `${BASE_SLOTS} standard slots + ${capacity - BASE_SLOTS} additional` : `${BASE_SLOTS} standard slots`}</span></p>
            {loadErr && <p className="form-error">{loadErr}</p>}
            {comments && comments.length === 0 && <p className="hint">No thoughts yet — the first comment will appear here.</p>}
            <ul className="comment-list">{comments?.map((c) => <CommentCard key={c.id} c={c} mine={backend.canEdit(c)} onEdit={status.open ? () => startForm(c) : undefined} />)}</ul>
            {full && !mineHere && (
              <div className="full-message" data-testid="full-message" role="note">
                <strong>{FULL_TITLE}</strong>
                <p>{FULL_TEXT}</p>
              </div>
            )}
            {blocker && blocker !== 'project_full' && blocker !== 'already_reviewed' && (
              <p id="block-msg" className={`hint block-${blocker}`} data-testid="block-message">{blocker === 'paused' ? 'Feedback is paused right now — you can still explore and read.' : blocker === 'self_review' ? "This is your own world — you can read your feedback here, but you can't review yourself." : RULE_MESSAGES[blocker]}</p>
            )}
            {!mineHere && (
              <button type="button" className="btn primary big" data-testid="leave-thoughts" disabled={!!blocker} onClick={() => startForm(null)} aria-describedby={blocker && blocker !== 'project_full' && blocker !== 'already_reviewed' ? 'block-msg' : undefined}>
                <Sparkles size={18} aria-hidden="true" /> {FORM_TITLE}
              </button>
            )}
            {pendingHere && !mineHere && <p className="hint quest-note">★ This world is on your Feedback Quest.</p>}
          </div>
        </div>
      )}

      {(step === 'form' || step === 'preview') && (
        <div className="form-step">
          <button type="button" className="btn small ghost back" onClick={() => setStep(step === 'preview' ? 'form' : 'profile')}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          <header className="form-head">
            <CreatureSvg spec={spec} size={72} animate={!reducedMotion} />
            <div>
              <h2 id="profile-title">{editing ? 'Edit Your Thoughts' : FORM_TITLE}</h2>
              <p className="subtitle">{FORM_SUBTITLE}</p>
              <p className="hint">For <strong>{student.fullName}</strong>'s world</p>
            </div>
          </header>
          {step === 'form' ? (
            <form className="feedback-form" onSubmit={toPreview} data-testid="feedback-form" noValidate>
              <div className="name-row">
                <label className="field name-pick"><span>Your name</span>
                  <select value={reviewerId} onChange={(e) => { setReviewerId(e.target.value); setErr(null) }} disabled={!!editing} required data-testid="fb-who" aria-invalid={err?.field === 'reviewer'} data-autofocus>
                    <option value="">Choose your name…</option>
                    {COURSES[student.course].sections.map((sec) => (
                      <optgroup key={sec.key} label={sec.code}>
                        {classmates.filter((s) => s.section === sec.key).sort((a, b) => a.lastName.localeCompare(b.lastName)).map((s) => (
                          <option key={s.id} value={s.id} disabled={!editing && reviewedHere.has(s.id)}>{s.fullName}{!editing && reviewedHere.has(s.id) ? ' (already reviewed)' : ''}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="field"><span>Pronouns <em>(optional)</em></span><input value={form.pronouns} maxLength={PRONOUNS_MAX} onChange={(e) => setForm({ ...form, pronouns: e.target.value })} placeholder="e.g. she/her, he/him, they/them" data-testid="fb-pronouns" aria-invalid={err?.field === 'pronouns'} /></label>
              </div>
              <p className="hint id-note" data-testid="honor-note">{HONOR_NOTE} Only {COURSES[student.course].code} students can review this world.</p>
              {selBlock && <p className="hint block-sel" data-testid="sel-block">{selBlockText}</p>}
              <label className="field">
                <span>{Q1}</span>
                <textarea rows={4} value={form.enjoyed} maxLength={TEXT_MAX} onChange={(e) => setForm({ ...form, enjoyed: e.target.value })} data-testid="fb-q1" aria-invalid={err?.field === 'enjoyed'} placeholder="I loved how…" data-autofocus />
                <small className="counter">{form.enjoyed.trim().length < TEXT_MIN ? `${TEXT_MIN - form.enjoyed.trim().length} more characters needed` : `${form.enjoyed.length} / ${TEXT_MAX}`}</small>
              </label>
              <label className="field">
                <span>{Q2}</span>
                <textarea rows={4} value={form.suggestion} maxLength={TEXT_MAX} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} data-testid="fb-q2" aria-invalid={err?.field === 'suggestion'} placeholder="Add…" />
                <small className="counter">{form.suggestion.trim().length < TEXT_MIN ? `${TEXT_MIN - form.suggestion.trim().length} more characters needed` : `${form.suggestion.length} / ${TEXT_MAX}`}</small>
              </label>
              {err && <p className="form-error" role="alert" data-testid="form-error">{err.msg}</p>}
              <button type="submit" className="btn primary big" data-testid="fb-preview"><Eye size={18} aria-hidden="true" /> Preview my comment</button>
            </form>
          ) : (
            <div className="preview" data-testid="preview">
              <p className="hint">This is exactly how your comment will appear to {student.firstName} and classmates:</p>
              <blockquote className="comment preview-card" data-testid="preview-text">{previewText}</blockquote>
              <p className="hint">The two questions aren't shown — just this paragraph, your name and the date. Not quite right? Go back and change your answers.</p>
              {err && <p className="form-error" role="alert" data-testid="form-error">{err.msg}</p>}
              <div className="row">
                <button type="button" className="btn" onClick={() => setStep('form')}><PencilLine size={18} aria-hidden="true" /> Change answers</button>
                <button type="button" className="btn primary big" onClick={send} disabled={busy} data-testid="fb-submit"><Send size={18} aria-hidden="true" /> {busy ? 'Sending…' : editing ? 'Save changes' : 'Send my thoughts'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="done-step" data-testid="done">
          <Celebrate />
          <CreatureSvg spec={spec} size={140} animate={!reducedMotion} active />
          <h2 id="profile-title">Thank you{sent ? `, ${students.find((s) => s.id === sent.reviewerId)?.firstName ?? ''}` : ''}!</h2>
          <p>Your thoughts are on {student.firstName}'s desk:</p>
          {sent && <blockquote className="comment preview-card" data-testid="done-text">{composeComment({ reviewerName: sent.reviewerName, pronouns: sent.pronouns, enjoyed: sent.enjoyed, suggestion: sent.suggestion })}</blockquote>}
          {me && <p className="progress-line" data-testid="done-progress">Your Feedback Quest: {Math.min(me.completed, me.required)} / {me.required} completed</p>}
          <p className="hint" data-testid="done-slots">{student.firstName}'s world now has {published} of {capacity} feedback slots filled.</p>
          {nowDone && !editing && (
            <div className="congrats" data-testid="done-congrats"><PartyPopper size={22} aria-hidden="true" /><div><strong>{CONGRATS_TITLE}</strong><p>{CONGRATS_TEXT}</p><p>{CONGRATS_MORE}</p></div></div>
          )}
          <div className="row center">
            <button type="button" className="btn" onClick={() => setStep('profile')}>See the comments</button>
            {!nowDone && <button type="button" className="btn primary" onClick={onFindNext} data-testid="done-find-next"><Compass size={16} aria-hidden="true" /> Find My Next Review</button>}
            <button type="button" className={`btn${nowDone ? ' primary' : ''}`} onClick={onExploreAnother} data-testid="done-explore-another"><Shuffle size={16} aria-hidden="true" /> Explore Another World</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
