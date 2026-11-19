import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, MessageCircleHeart, PencilLine, Sparkles, Eye, ArrowLeft, Send } from 'lucide-react'
import type { Student } from '../../shared/roster.ts'
import { composeComment } from '../../shared/compose.ts'
import { MAX_COMMENTS_PER_PROJECT, MAX_REVIEWS_PER_REVIEWER, PRONOUNS_MAX, TEXT_MAX, TEXT_MIN, validateFeedback, RULE_MESSAGES } from '../../shared/rules.ts'
import { CREATURE_BY_ID, useApp, MODE } from '../lib/app.tsx'
import { BackendError, type CommentView } from '../lib/backend.ts'
import { Modal } from './Modal.tsx'
import { CreatureSvg } from './CreatureSvg.tsx'
import { SignInPanel } from './SignIn.tsx'
import { Celebrate } from './Celebrate.tsx'

/** Only http(s) links that parse are ever turned into a button. */
export function safeProjectUrl(s: Student): string | null {
  if (s.urlStatus !== 'valid' || !s.url) return null
  try { const u = new URL(s.url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null }
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

type Step = 'profile' | 'signin' | 'form' | 'preview' | 'done'

export function ProfileModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const { backend, me, counts, refresh, reducedMotion, byId } = useApp()
  const spec = CREATURE_BY_ID.get(student.creatureId)
  const url = safeProjectUrl(student)
  const [comments, setComments] = useState<CommentView[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('profile')
  const [editing, setEditing] = useState<CommentView | null>(null)
  const [form, setForm] = useState({ pronouns: '', enjoyed: '', suggestion: '' })
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setComments(await backend.comments(student.id)); setLoadErr(null) } catch (e) { setLoadErr(e instanceof BackendError ? e.message : 'Could not load comments.') }
  }, [backend, student.id])
  useEffect(() => { if (url) load() }, [load, url])

  if (!url || !spec) {
    return (
      <Modal title={`${student.fullName}'s desk`} onClose={onClose} className="profile empty-profile" testId="profile-modal">
        <div className="empty-hero" aria-hidden="true"><span className="empty-chair big"><span className="chair-back" /></span><span className="floating-envelope">✉</span></div>
        <h2 className="profile-name">{student.fullName}</h2>
        <p className="section-chip">{student.sectionCode}</p>
        <p className="empty-message" data-testid="empty-message">This project hasn't arrived yet!</p>
        {student.urlStatus === 'invalid' && <p className="hint">The submitted link can't be opened by classmates (for example, a link to a file on someone's own computer).</p>}
        <button type="button" className="btn" onClick={onClose}>Back to the classroom</button>
      </Modal>
    )
  }

  const received = comments ? comments.length : counts[student.id] ?? 0
  const full = received >= MAX_COMMENTS_PER_PROJECT
  const mineHere = comments?.find((c) => c.reviewerId === me?.studentId) ?? null
  const isSelf = me?.studentId === student.id
  const atLimit = !!me && me.reviewsWritten >= MAX_REVIEWS_PER_REVIEWER && !mineHere

  const startForm = (edit: CommentView | null) => {
    setErr(null); setEditing(edit)
    setForm(edit ? { pronouns: edit.pronouns ?? '', enjoyed: edit.enjoyed, suggestion: edit.suggestion } : { pronouns: form.pronouns, enjoyed: '', suggestion: '' })
    setStep(me ? 'form' : 'signin')
  }
  const toPreview = (e: React.FormEvent) => {
    e.preventDefault()
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
      if (editing) await backend.update(editing.id, form); else await backend.submit(student.id, form)
      await Promise.all([load(), refresh()])
      setStep('done')
    } catch (e) {
      setErr({ msg: e instanceof BackendError ? e.message : 'Could not send your feedback. Please try again.' })
      if (e instanceof BackendError && ['project_full', 'already_reviewed', 'self_review', 'reviewer_limit'].includes(e.code)) { await Promise.all([load(), refresh()]); setStep('profile') }
    } finally { setBusy(false) }
  }

  const previewText = me ? composeComment({ reviewerName: me.fullName, pronouns: form.pronouns, enjoyed: form.enjoyed, suggestion: form.suggestion }) : ''
  const meRow = me ? byId.get(me.studentId) : undefined
  const meStudent = meRow ? { first: meRow.firstName, last: meRow.lastName } : null

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
            <a className="btn primary explore" href={url} target="_blank" rel="noopener noreferrer" data-testid="explore-link">
              <ExternalLink size={18} aria-hidden="true" /> Explore This World
            </a>
            <p className="url-line" title={url}>{url.replace(/^https?:\/\//, '')} <span className="hint">(opens in a new tab)</span></p>
          </div>
          <div className="profile-comments">
            <h3><MessageCircleHeart size={20} aria-hidden="true" /> Peer thoughts <span className="count-pill" data-testid="comment-count">{received} / {MAX_COMMENTS_PER_PROJECT}</span></h3>
            {loadErr && <p className="form-error">{loadErr}</p>}
            {MODE === 'live' && !me && <p className="hint">Sign in to read your classmates' comments.</p>}
            {comments && comments.length === 0 && <p className="hint">No thoughts yet — be the first to share something kind and helpful!</p>}
            <ul className="comment-list">{comments?.map((c) => <CommentCard key={c.id} c={c} mine={c.reviewerId === me?.studentId} onEdit={() => startForm(c)} />)}</ul>
            {full && !mineHere && <p className="full-message" data-testid="full-message">This desk is full of thoughtful feedback! Thank you for helping your classmates.</p>}
            {isSelf && <p className="hint self" data-testid="self-message">This is your own world — you can read your feedback here, but you can't review yourself.</p>}
            {atLimit && !full && !isSelf && <p className="hint" data-testid="limit-message">{RULE_MESSAGES.reviewer_limit}</p>}
            {!mineHere && (
              <button type="button" className="btn primary big" data-testid="leave-thoughts" disabled={full || isSelf || atLimit} onClick={() => startForm(null)}>
                <Sparkles size={18} aria-hidden="true" /> Leave Your Thoughts
              </button>
            )}
          </div>
        </div>
      )}

      {step === 'signin' && (
        <div className="form-step">
          <button type="button" className="btn small ghost back" onClick={() => setStep('profile')}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          <SignInPanel onDone={() => setStep('form')} />
        </div>
      )}

      {(step === 'form' || step === 'preview') && me && (
        <div className="form-step">
          <button type="button" className="btn small ghost back" onClick={() => setStep(step === 'preview' ? 'form' : 'profile')}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
          <header className="form-head">
            <CreatureSvg spec={spec} size={72} animate={!reducedMotion} />
            <div>
              <h2 id="profile-title">{editing ? 'Edit Your Thoughts' : 'Leave Your Thoughts'}</h2>
              <p className="subtitle">Share something you loved and one idea that could make this world even better!</p>
              <p className="hint">For <strong>{student.fullName}</strong>'s world</p>
            </div>
          </header>
          {step === 'form' ? (
            <form className="feedback-form" onSubmit={toPreview} data-testid="feedback-form" noValidate>
              <div className="name-row">
                <label className="field"><span>First name</span><input value={meStudent?.first ?? ''} readOnly aria-readonly="true" data-testid="fb-first" /></label>
                <label className="field"><span>Last name</span><input value={meStudent?.last ?? ''} readOnly aria-readonly="true" data-testid="fb-last" /></label>
                <label className="field"><span>Pronouns <em>(optional)</em></span><input value={form.pronouns} maxLength={PRONOUNS_MAX} onChange={(e) => setForm({ ...form, pronouns: e.target.value })} placeholder="e.g. she/her, he/him, they/them" data-testid="fb-pronouns" aria-invalid={err?.field === 'pronouns'} /></label>
              </div>
              <p className="hint id-note">{MODE === 'live' ? 'Your name comes from your access code, so classmates know the comment is really from you.' : 'Demo: your name comes from the classmate you chose. In the real classroom it comes from your access code.'}</p>
              <label className="field">
                <span>What did you enjoy most about this website? Share a specific compliment!</span>
                <textarea rows={4} value={form.enjoyed} maxLength={TEXT_MAX} onChange={(e) => setForm({ ...form, enjoyed: e.target.value })} data-testid="fb-q1" aria-invalid={err?.field === 'enjoyed'} placeholder="I loved how…" data-autofocus />
                <small className="counter">{form.enjoyed.trim().length < TEXT_MIN ? `${TEXT_MIN - form.enjoyed.trim().length} more characters needed` : `${form.enjoyed.length} / ${TEXT_MAX}`}</small>
              </label>
              <label className="field">
                <span>What is one improvement or new feature you would suggest?</span>
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
          <CreatureSvg spec={spec} size={160} animate={!reducedMotion} active />
          <h2 id="profile-title">Thank you{me ? `, ${me.fullName.split(' ')[0]}` : ''}!</h2>
          <p>Your thoughts are on {student.firstName}'s desk.</p>
          {me && <p className="progress-line" data-testid="done-progress">Your reviews: {me.reviewsWritten} / {MAX_REVIEWS_PER_REVIEWER}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep('profile')}>See the comments</button>
            <button type="button" className="btn primary" onClick={onClose}>Back to the classroom</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
