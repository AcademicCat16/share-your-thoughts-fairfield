import { useMemo } from 'react'
import { ArrowRight, BookOpen } from 'lucide-react'
import { useApp, go, MODE, CREATURE_BY_ID } from '../lib/app.tsx'
import { CreatureSvg } from '../components/CreatureSvg.tsx'
import { COURSES, isReviewable, type CourseKey } from '../../shared/roster.ts'

export const HOME_TITLE = 'Fairfield Interactive Worlds'
export const HOME_SUBTITLE = "Explore your classmates' creations, discover new ideas, and share your thoughts!"

function ClassCard({ course, index }: { course: CourseKey; index: number }) {
  const { students, reducedMotion, me } = useApp()
  const info = COURSES[course]
  const list = students.filter((s) => s.course === course)
  // A little parade of this classroom's own creatures (only ones already at a desk).
  const parade = useMemo(() => list.filter(isReviewable).slice(0, 40).filter((_, i) => i % 6 === index % 3).slice(0, 5)
    .map((s) => CREATURE_BY_ID.get(s.creatureId)).filter((c) => !!c), [list, index])
  const working = list.filter(isReviewable).length
  return (
    <article className={`class-card course-${course}`} aria-labelledby={`cc-${course}`} data-testid={`class-card-${course}`} style={{ animationDelay: `${index * 0.12}s` }}>
      <div className="class-card-sky" aria-hidden="true">
        {parade.map((c, i) => <span key={c!.id} className="cc-creature" style={{ animationDelay: `${i * 0.35}s` }}><CreatureSvg spec={c!} size={76} animate={!reducedMotion} /></span>)}
      </div>
      <div className="class-card-body">
        <p className="eyebrow">{info.code}</p>
        <h2 id={`cc-${course}`}>{info.title}</h2>
        <p className="cc-count"><strong data-testid={`class-count-${course}`}>{list.length} Students</strong>{course === '2241' ? ' · Sections 01 + 02 together' : ''}</p>
        <p className="hint">{working} interactive worlds ready to explore{me?.course === course ? ' · this is your classroom' : ''}</p>
        <button type="button" className="btn primary big" onClick={() => go(course)} data-testid={`enter-${course}`}>Enter Classroom <ArrowRight size={18} aria-hidden="true" /></button>
      </div>
    </article>
  )
}

export function HomePage() {
  return (
    <main className="home" id="main" tabIndex={-1} data-testid="home">
      <div className="leaves" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} style={{ left: `${(i * 8.3) % 100}%`, animationDelay: `${(i * 0.8) % 6}s`, animationDuration: `${8 + (i % 5)}s` }}>{i % 3 ? '🍂' : '🍁'}</span>)}</div>
      <header className="home-hero">
        <h1 className="floating-title" data-testid="home-title">{HOME_TITLE}</h1>
        <p className="home-sub">{HOME_SUBTITLE}</p>
      </header>
      <div className="class-cards">
        <ClassCard course="1101" index={0} />
        <ClassCard course="2241" index={1} />
      </div>
      <p className="home-foot">
        <button type="button" className="btn ghost" onClick={() => go('guide')}><BookOpen size={17} aria-hidden="true" /> How it works — Student Guide</button>
      </p>
      {MODE === 'demo' && <p className="demo-note">Demo Mode — comments are stored only in this browser.</p>}
    </main>
  )
}
