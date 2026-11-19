import { CREATURES } from '../../shared/creatures.ts'
import { CreatureSvg } from '../components/CreatureSvg.tsx'
import { go, useApp, MODE } from '../lib/app.tsx'

const STEPS = [
  { t: 'Enter the classroom.', d: 'Press “Enter the Classroom” on the welcome screen. You’ll see every desk from both sections.' },
  { t: 'Find a classmate’s creature.', d: 'Look around, search for a name, or press “Find a World That Needs Feedback” and we’ll pick a classmate who needs reviews.' },
  { t: 'Click the creature.', d: 'Each creature belongs to one classmate. Their name is on the folded name card on the desk.' },
  { t: 'Explore their interactive website.', d: 'Press “Explore This World”. Their website opens in a new tab. Take your time and try things out!' },
  { t: 'Return to the classroom.', d: 'Come back to this tab when you’re done exploring. The classroom is waiting right where you left it.' },
  { t: 'Click “Leave Your Thoughts.”', d: MODE === 'live' ? 'The first time, choose your name and type the private access code from your instructor.' : 'In this test version, choose which classmate you are. (The real version uses a private access code.)' },
  { t: 'Write one compliment and one helpful suggestion.', d: 'Be specific! You’ll see a preview of your comment before you send it.' },
  { t: 'Submit — then repeat until you’ve reviewed four different classmates.', d: 'Your progress shows at the top: “Your reviews: 2 / 4”.' },
]

const GOOD = [
  ['Be kind and specific.', '“I loved how the colors change when I pick a flavor” is more helpful than “nice site.”'],
  ['Make your suggestion useful.', 'Suggest one thing the creator could actually try, like “add a back button on the recipe page.”'],
  ['You can’t review your own project.', 'Your own desk shows your feedback, but the button is turned off for you.'],
  ['Each project can receive four reviews.', 'When a desk has four, it’s full — pick another world. Comments can be edited without using up a spot.'],
  ['You can review either section.', 'Classmates in 2241-01 and 2241-02 are all in the same room.'],
  ['One comment per classmate.', 'If you want to change what you wrote, open their desk and press “Edit my comment.”'],
]

export function GuidePage() {
  const { reducedMotion } = useApp()
  const helpers = [CREATURES[3], CREATURES[17], CREATURES[29], CREATURES[44]]
  return (
    <main className="guide" id="main" tabIndex={-1}>
      <header className="guide-hero">
        <div className="guide-pals" aria-hidden="true">{helpers.map((c) => c && <CreatureSvg key={c.id} spec={c} size={86} animate={!reducedMotion} />)}</div>
        <h1>Student Guide</h1>
        <p className="lead">Visit your classmates’ worlds and leave them some thoughtful Thanksgiving feedback. Everything happens right here on this page.</p>
      </header>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={i} className="step">
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <div><h2><span className="sr-only">Step {i + 1}: </span>{s.t}</h2><p>{s.d}</p></div>
          </li>
        ))}
      </ol>
      <section className="good-feedback" aria-labelledby="gf">
        <h2 id="gf">Good to know</h2>
        <ul>{GOOD.map(([h, d]) => <li key={h}><strong>{h}</strong> {d}</li>)}</ul>
      </section>
      <p className="guide-cta"><button type="button" className="btn primary big" onClick={() => go('classroom')}>Go to the classroom</button></p>
    </main>
  )
}
