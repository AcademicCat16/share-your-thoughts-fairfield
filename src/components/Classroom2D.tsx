import { memo } from 'react'
import { COURSES, isReviewable, unavailableReason, type CourseKey, type Student } from '../../shared/roster.ts'
import { BASE_SLOTS } from '../../shared/rules.ts'
import { CREATURE_BY_ID, useApp, slotsOf } from '../lib/app.tsx'
import { seatGrid, COLS } from '../lib/layout.ts'
import { CreatureSvg } from './CreatureSvg.tsx'

export function seatLabel(s: Student, published: number, capacity: number): string {
  if (s.hidden) return `Reserved seat, ${s.sectionCode}.`
  if (unavailableReason(s)) return `${s.fullName}, ${s.sectionCode}. Empty seat — ${unavailableReason(s) === 'broken' ? "the project link isn't working yet" : "project hasn't arrived yet"}.`
  const c = CREATURE_BY_ID.get(s.creatureId)
  return `${s.fullName}, ${s.sectionCode}. ${c ? `${c.name} the ${c.category} creature. ` : ''}${published} of ${capacity} feedback slots filled${published >= capacity ? ' — full, still open to explore' : ''}.`
}

/** Feedback slot dots: the four standard slots, then extra slots in a different style. */
export function SlotDots({ published, capacity, className = '' }: { published: number; capacity: number; className?: string }) {
  return (
    <span className={`review-dots${published >= capacity ? ' full' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: capacity }, (_, i) => <i key={i} className={`${i < published ? 'on' : ''}${i >= BASE_SLOTS ? ' extra' : ''}`} />)}
    </span>
  )
}

const Desk = memo(function Desk({ s, published, capacity, dim, selected, animate, assigned, onPick }: { s: Student; published: number; capacity: number; dim: boolean; selected: boolean; animate: boolean; assigned: boolean; onPick: (id: string) => void }) {
  const spec = CREATURE_BY_ID.get(s.creatureId)
  const filled = isReviewable(s) && spec
  return (
    <button type="button" className={`desk2d sec-${s.section}${filled ? '' : ' empty'}${dim ? ' dim' : ''}${selected ? ' selected' : ''}${assigned ? ' assigned' : ''}`}
      data-testid={`desk-${s.id}`} data-student={s.id} aria-label={seatLabel(s, published, capacity) + (assigned ? ' On your Feedback Quest.' : '')} onClick={() => onPick(s.id)}>
      {assigned && <span className="quest-flag" aria-hidden="true">★</span>}
      <span className="desk2d-seat" aria-hidden="true">
        {filled ? <CreatureSvg spec={spec} size="100%" animate={animate} /> : <span className="empty-chair"><span className="chair-back" /><span className="empty-note">{s.hidden ? 'reserved' : '✉ on its way'}</span></span>}
      </span>
      <span className="desk2d-top" aria-hidden="true" />
      <span className="nameplate" aria-hidden="true">
        <span className="np-first">{s.hidden ? 'Reserved' : s.firstName}</span>
        <span className="np-last">{s.hidden ? 'seat' : s.lastName}</span>
        <span className="np-sec">{s.sectionCode.replace('MKTG ', '')}</span>
      </span>
      {filled && <SlotDots published={published} capacity={capacity} />}
    </button>
  )
})

export function Classroom2D({ course, students, highlight, onPick }: { course: CourseKey; students: Student[]; highlight: Set<string> | null; onPick: (id: string) => void }) {
  const { status, selected, reducedMotion, quest } = useApp()
  const mine = new Set(quest.filter((q) => q.status === 'pending').map((q) => q.projectId))
  return (
    <div className="classroom2d" data-testid="classroom-2d">
      {COURSES[course].sections.map((sec) => {
        const list = students.filter((s) => s.section === sec.key).sort((a, b) => a.position - b.position)
        if (!list.length) return null
        const grid = seatGrid(list.length, COLS)
        const rows = Math.max(0, ...grid.map((g) => g.row)) + 1
        return (
          <section key={sec.key} className={`section2d sec-${sec.key}`} aria-label={`${sec.code}, ${list.length} seats`}>
            <h2 className="section-title"><span>{sec.code}</span><small>{course === '1101' ? `${COURSES[course].title} · ` : ''}{list.length} seats</small></h2>
            <div className="desk-grid" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
              {list.map((s, i) => {
                const sl = slotsOf(status, s.id)
                return (
                  <div key={s.id} className="desk-cell" style={{ gridRow: grid[i].row + 1, gridColumn: `${Math.round(grid[i].col * 2) + 1} / span 2` }}>
                    <Desk s={s} published={sl.published} capacity={sl.capacity} dim={!!highlight && !highlight.has(s.id)} selected={selected === s.id} animate={!reducedMotion} assigned={mine.has(s.id)} onPick={onPick} />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
