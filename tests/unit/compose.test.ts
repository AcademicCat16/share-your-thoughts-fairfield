import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeComment, composeEnjoyed, composeSuggestion, subjectPronoun } from '../../shared/compose.ts'

const N = 'Youngdai Won'

test('the example from the brief', () => {
  assert.equal(
    composeComment({ reviewerName: N, enjoyed: 'I loved the interactive animations and thought the website was easy to explore', suggestion: 'Add more customization options' }),
    'Youngdai Won loved the interactive animations and thought the website was easy to explore. One suggestion was to add more customization options.')
})

test('first-person openings become the reviewer name; the rest is word for word', () => {
  assert.equal(composeEnjoyed(N, 'I really liked how the colors change!'), 'Youngdai Won really liked how the colors change!')
  assert.equal(composeEnjoyed(N, 'i enjoy the music'), 'Youngdai Won enjoyed the music.')
  assert.equal(composeEnjoyed(N, 'My favorite part was the 3D globe.'), "Youngdai Won's favorite part was the 3D globe.")
  assert.equal(composeEnjoyed(N, 'I was impressed by the recipe filter'), 'Youngdai Won was impressed by the recipe filter.')
})

test('anything that cannot be safely rephrased is kept verbatim after a neutral lead-in', () => {
  assert.equal(composeEnjoyed(N, 'The animations were so smooth'), 'What Youngdai Won enjoyed most: the animations were so smooth.')
  // a later "I" would read wrongly after a rewrite → verbatim
  assert.equal(composeEnjoyed(N, 'I loved it. I also liked the sounds.'), 'What Youngdai Won enjoyed most: I loved it. I also liked the sounds.')
  assert.equal(composeSuggestion('Maybe a dark mode?'), 'One idea to make it even better: maybe a dark mode?')
  assert.equal(composeSuggestion('My only idea is a search bar'), 'One idea to make it even better: my only idea is a search bar.')
})

test('suggestions: imperative, "you could", "I would suggest"; pronouns only when given', () => {
  assert.equal(composeSuggestion('You could add a back button'), 'One suggestion was that you could add a back button.')
  assert.equal(composeSuggestion('I would suggest adding sound effects'), 'One suggestion was adding sound effects.')
  assert.equal(composeSuggestion('I would suggest adding sound effects', 'she/her'), 'She suggested adding sound effects.')
  assert.equal(composeSuggestion('I would suggest adding sound effects', 'they/them'), 'They suggested adding sound effects.')
  assert.equal(composeSuggestion('I would suggest adding sound effects', 'xe/xem'), 'One suggestion was adding sound effects.', 'unknown pronouns → neutral, never guessed')
  assert.equal(subjectPronoun(''), null)
})

test('no words are added or lost: every answer word appears in the paragraph', () => {
  const cases = [
    ['I loved the cute cupcake toppings and the sprinkles', 'Add a way to save my cupcake'],
    ['Great layout with very clear buttons', 'I suggest a tutorial at the start'],
    ['so fun!!', 'more levels'],
  ]
  for (const [a, b] of cases) {
    const out = composeComment({ reviewerName: 'Sam Lee', enjoyed: a, suggestion: b }).toLowerCase()
    for (const w of `${a} ${b}`.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['loved', 'suggest'].includes(w))) {
      assert.ok(out.includes(w), `"${w}" kept in: ${out}`)
    }
  }
})
