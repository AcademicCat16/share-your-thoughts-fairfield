import type { CourseKey, Student } from '../../shared/roster.ts'
import type { FeedbackInput, RuleError } from '../../shared/rules.ts'
import type { QuestItem } from '../../shared/engine.ts'
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

/** The verified signed-in student. Everything here comes from the server (Live) — never from typed input. */
export interface Me {
  studentId: string
  fullName: string
  firstName: string
  lastName: string
  course: CourseKey
  sectionCode: string
  completed: number
  required: number
  participating: boolean
}

export interface ProjectStatus { published: number; capacity: number }
export interface PublicStatus { open: boolean; allowExtra: boolean; projects: Record<string, ProjectStatus> }

export interface AdminComment extends CommentView { course: CourseKey; status: 'published' | 'removed'; removedReason?: string | null; extra?: boolean }
export interface AdminAssignment { course: CourseKey; reviewerId: string; projectId: string; status: 'pending' | 'completed' | 'released' }
export interface AdminStudent { id: string; participating: boolean; capacity: number; published: number; written: number }
export interface AdminOverview {
  open: boolean
  allowExtra: boolean
  baseSlots: number
  perStudent: number
  students: AdminStudent[]
  assignments: AdminAssignment[]
  comments: AdminComment[]
}

export interface Backend {
  mode: Mode
  /** Who is signed in (verified identity), or null. */
  me(): Promise<Me | null>
  /** Live: the private access code alone identifies the student (verified on the server). Demo: pick a student. */
  signIn(cred: { code?: string; studentId?: string }): Promise<Me>
  signOut(): Promise<void>
  /** Published counts and slot capacities for every eligible project (no names, no text). */
  status(): Promise<PublicStatus>
  comments(projectId: string): Promise<CommentView[]>
  myReviews(): Promise<CommentView[]>
  quest(): Promise<QuestItem[]>
  nextReview(): Promise<string | null>
  submit(projectId: string, input: FeedbackInput): Promise<CommentView>
  update(commentId: string, input: FeedbackInput): Promise<CommentView>
  /** Instructor */
  instructorStatus(): Promise<{ signedIn: boolean; email?: string; isInstructor: boolean }>
  instructorSignIn(email: string): Promise<string>
  instructorSignOut(): Promise<void>
  adminOverview(): Promise<AdminOverview>
  applyAssignments(course: CourseKey, capacities: Record<string, number>, pending: { reviewerId: string; projectId: string }[]): Promise<void>
  setParticipating(studentId: string, participating: boolean): Promise<void>
  removeComment(id: string, reason: string): Promise<void>
  restoreComment(id: string): Promise<void>
  setOpen(open: boolean): Promise<void>
  setAllowExtra(allow: boolean): Promise<void>
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

export type { Student, QuestItem }
