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

/**
 * The student this browser has chosen to be (HONOR SYSTEM: picked from the roster, not verified). Progress numbers come
 * from the server in Live mode.
 */
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
  /** The name this browser chose (honor system), or null. */
  me(): Promise<Me | null>
  /** Remember the chosen name in this browser (honor system — nothing is verified). */
  signIn(cred: { studentId: string }): Promise<Me>
  /** Forget the chosen name in this browser. */
  signOut(): Promise<void>
  /** Published counts and slot capacities for every eligible project (no names, no text). */
  status(): Promise<PublicStatus>
  comments(projectId: string): Promise<CommentView[]>
  myReviews(): Promise<CommentView[]>
  quest(): Promise<QuestItem[]>
  /** The Feedback Quest of any SELECTED student (used by the name dropdown in the feedback form). */
  questOf(studentId: string): Promise<QuestItem[]>
  nextReview(): Promise<string | null>
  /** Submit under the SELECTED name; the server checks every rule for that name. Remembers the name afterwards. */
  submit(projectId: string, input: FeedbackInput, reviewerId: string): Promise<CommentView>
  update(commentId: string, input: FeedbackInput): Promise<CommentView>
  /** Can this browser edit that comment? (Live: it holds the comment's edit token. Demo: it is the chosen name's.) */
  canEdit(c: CommentView): boolean
  /** Instructor (Live: Supabase e-mail + password; privileges are checked on the server) */
  instructorStatus(): Promise<{ signedIn: boolean; email?: string; isInstructor: boolean }>
  instructorSignIn(email: string, password: string): Promise<string>
  instructorChangePassword(newPassword: string): Promise<void>
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
