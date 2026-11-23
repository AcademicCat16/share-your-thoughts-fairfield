import { CREATURES } from '../../shared/creatures.ts'
import { CREATURES_1101 } from '../../shared/creatures1101.ts'
import { CreatureSvg } from '../components/CreatureSvg.tsx'
import { go, useApp } from '../lib/app.tsx'

/** Each step has a tiny picture so students can follow along without reading much. */
const STEPS: { t: string; d: string; pic: string }[] = [
  { t: 'Choose your classroom.', d: 'On the home page, press “Enter Classroom” on Principles of Marketing (1101) or Digital Marketing (2241).', pic: '🏫' },
  { t: 'Explore the colorful classroom.', d: 'Drag to look around, scroll to zoom — or switch to the simple 2D view.', pic: '🔭' },
  { t: 'Click a classmate’s creature.', d: 'Each creature belongs to one classmate. Their name is on the folded name card on the desk.', pic: '🐾' },
  { t: 'Visit their interactive website.', d: 'Press “Explore This World”. It opens in a new tab — try things out!', pic: '🌍' },
  { t: 'Return to the classroom.', d: 'Come back to this tab. The classroom is right where you left it.', pic: '↩️' },
  { t: 'Leave a compliment and a helpful suggestion.', d: 'Press “Leave Your Thoughts”, choose your own name from the list, then answer the two questions. (Honor system: please pick only your own name.)', pic: '💬' },
  { t: 'Complete four reviews.', d: 'Press “Find My Next Review” to jump to the next classmate on your Feedback Quest.', pic: '⭐' },
  { t: 'Keep exploring other students’ worlds!', d: 'Press “Explore Another World” any time — there is no limit on exploring.', pic: '✨' },
]

const GOOD: [string, string][] = [
  ['You cannot review your own website.', 'Your own desk shows your feedback, but the button is off for you.'],
  ['You can review only projects in your course.', 'Principles (1101) students review 1101 projects; Digital Marketing (2241) students review 2241 projects. You can still explore both rooms.'],
  ['Digital Marketing sections 01 and 02 are combined.', 'Both sections share one classroom and one review pool.'],
  ['Each student completes four reviews.', 'Four different classmates. Your progress shows at the top: “Your Feedback Quest: 2 / 4 completed”.'],
  ['Some projects may already have full comment slots.', 'Full projects can still be explored, and you can read what classmates shared.'],
  ['No installation or programming is required.', 'Everything happens right here in your web browser.'],
]

export function GuidePage() {
  const { reducedMotion } = useApp()
  const helpers = [CREATURES[3], CREATURES_1101[4], CREATURES[29], CREATURES_1101[17]]
  return (
    <main className="guide" id="main" tabIndex={-1} data-testid="guide">
      <header className="guide-hero">
        <div className="guide-pals" aria-hidden="true">{helpers.map((c) => c && <CreatureSvg key={c.id} spec={c} size={86} animate={!reducedMotion} />)}</div>
        <h1>Student Guide</h1>
        <p className="lead">Explore your classmates’ worlds and leave them thoughtful feedback. It takes eight easy steps.</p>
      </header>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={i} className="step" data-testid="guide-step">
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <div><h2><span className="sr-only">Step {i + 1}: </span>{s.t}</h2><p>{s.d}</p></div>
            <span className="step-pic" aria-hidden="true">{s.pic}</span>
          </li>
        ))}
      </ol>
      <section className="good-feedback" aria-labelledby="gf">
        <h2 id="gf">Good to know</h2>
        <ul>{GOOD.map(([h, d]) => <li key={h}><strong>{h}</strong> {d}</li>)}</ul>
        <div className="example-comment" aria-label="Example of good feedback">
          <p className="eyebrow">A good review looks like this</p>
          <p><strong>Compliment:</strong> “I loved how the colors change when I pick a flavor.”</p>
          <p><strong>Suggestion:</strong> “Add a back button on the recipe page.”</p>
        </div>
      </section>
      <p className="guide-cta"><button type="button" className="btn primary big" onClick={() => go('home')}>Choose my classroom</button></p>
    </main>
  )
}
