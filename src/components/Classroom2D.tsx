import { memo } from 'react'
import type { Student } from '../../shared/roster.ts'
import { MAX_COMMENTS_PER_PROJECT } from '../../shared/rules.ts'
import { CREATURE_BY_ID, useApp } from '../lib/app.tsx'
import { seatGrid } from '../lib/layout.ts'
import { CreatureSvg } from './CreatureSvg.tsx'

export function seatLabel(s: Student, received: number): string {
  if (s.urlStatus !== 'valid') return `${s.fullName}, ${s.sectionCode}. Empty seat — project hasn't arrived yet.`
  const c = CREATURE_BY_ID.get(s.creatureId)
  return `${s.fullName}, ${s.sectionCode}. ${c ? `${c.name} the ${c.category} creature. ` : ''}${received} of ${MAX_COMMENTS_PER_PROJECT} reviews.`
}

const Desk = memo(function Desk({ s, received, dim, selected, animate, onPick }: { s: Student; received: number; dim: boolean; selected: boolean; animate: boolean; onPick: (id: string) => void }) {
  const spec = CREATURE_BY_ID.get(s.creatureId)
  const filled = s.urlStatus === 'valid' && spec
  return (
    <button type="button" className={`desk2d sec-${s.section}${filled ? '' : ' empty'}${dim ? ' dim' : ''}${selected ? ' selected' : ''}`}
      data-testid={`desk-${s.id}`} data-student={s.id} aria-label={seatLabel(s, received)} onClick={() => onPick(s.id)}>
      <span className="desk2d-seat" aria-hidden="true">
        {filled ? <CreatureSvg spec={spec} size="100%" animate={animate} /> : <span className="empty-chair"><span className="chair-back" /><span className="empty-note">✉ on its way</span></span>}
      </span>
      <span className="desk2d-top" aria-hidden="true" />
      <span className="nameplate" aria-hidden="true">
        <span className="np-first">{s.firstName}</span>
        <span className="np-last">{s.lastName}</span>
        <span className="np-sec">{s.sectionCode.replace('MKTG ', '')}</span>
      </span>
      {filled && <span className={`review-dots${received >= MAX_COMMENTS_PER_PROJECT ? ' full' : ''}`} aria-hidden="true">{Array.from({ length: MAX_COMMENTS_PER_PROJECT }, (_, i) => <i key={i} className={i < received ? 'on' : ''} />)}</span>}
    </button>
  )
})

export function Classroom2D({ students, highlight, onPick }: { students: Student[]; highlight: Set<string> | null; onPick: (id: string) => void }) {
  const { counts, selected, reducedMotion } = useApp()
  return (
    <div className="classroom2d" data-testid="classroom-2d">
      {(['01', '02'] as const).map((sec) => {
        const list = students.filter((s) => s.section === sec).sort((a, b) => a.position - b.position)
        const grid = seatGrid(list)
        const rows = Math.max(0, ...grid.map((g) => g.row)) + 1
        return (
          <section key={sec} className={`section2d sec-${sec}`} aria-label={`Section MKTG 2241-${sec}, ${list.length} seats`}>
            <h2 className="section-title"><span>MKTG 2241-{sec}</span><small>{list.length} seats</small></h2>
            <div className="desk-grid" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
              {list.map((s, i) => (
                <div key={s.id} className="desk-cell" style={{ gridRow: grid[i].row + 1, gridColumn: `${Math.round(grid[i].col * 2) + 1} / span 2` }}>
                  <Desk s={s} received={counts[s.id] ?? 0} dim={!!highlight && !highlight.has(s.id)} selected={selected === s.id} animate={!reducedMotion} onPick={onPick} />
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
