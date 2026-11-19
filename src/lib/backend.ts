import type { Student } from '../../shared/roster.ts'
import type { FeedbackInput, RuleError } from '../../shared/rules.ts'
import { RULE_MESSAGES } from '../../shared/rules.ts'

export type Mode = 'demo' | 'live'

export interface CommentView {
  id: string
  projectId: string
  reviewerId: string
  reviewerName: string
  pronouns: string | null
  enjoyed: string
  suggestion: string
  createdAt: string
  updatedAt: string
}

export interface Me { studentId: string; fullName: string; section: string; reviewsWritten: number }

export interface AdminComment extends CommentView { status: 'published' | 'removed'; removedReason?: string | null }
export interface AdminOverview { open: boolean; maxPerProject: number; maxPerReviewer: number; comments: AdminComment[] }

export interface Backend {
  mode: Mode
  /** Who is signed in (verified identity), or null. */
  me(): Promise<Me | null>
  /** Demo: pick a classmate to act as (no code). Live: access code is verified on the server. */
  signIn(studentId: string, code: string): Promise<Me>
  signOut(): Promise<void>
  counts(): Promise<Record<string, number>>
  comments(projectId: string): Promise<CommentView[]>
  myReviews(): Promise<CommentView[]>
  submit(projectId: string, input: FeedbackInput): Promise<CommentView>
  update(commentId: string, input: FeedbackInput): Promise<CommentView>
  recommend(): Promise<string | null>
  /** Instructor */
  instructorStatus(): Promise<{ signedIn: boolean; email?: string; isInstructor: boolean }>
  instructorSignIn(email: string): Promise<string>
  instructorSignOut(): Promise<void>
  adminOverview(): Promise<AdminOverview>
  removeComment(id: string, reason: string): Promise<void>
  restoreComment(id: string): Promise<void>
  setOpen(open: boolean): Promise<void>
  /** Notify when shared data may have changed (another tab, polling). Returns unsubscribe. */
  subscribe(cb: () => void): () => void
}

export class BackendError extends Error {
  code: RuleError | 'network' | 'unknown'
  field?: string
  constructor(code: BackendError['code'], message?: string, field?: string) {
    super(message ?? (code in RULE_MESSAGES ? RULE_MESSAGES[code as RuleError] : 'Something went wrong. Please try again.'))
    this.code = code; this.field = field
  }
}

export type { Student }
