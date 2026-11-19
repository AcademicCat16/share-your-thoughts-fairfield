/**
 * Turns the two feedback answers into one readable paragraph, e.g.
 *   "Youngdai Won loved the interactive animations. One suggestion was to add more customization options."
 *
 * Deliberately rule-based (no AI): it only rewrites the *opening words* of an answer from first person into
 * the reviewer's name ("I loved" → "Youngdai Won loved"). Everything after the opening is kept word for word.
 * When an answer can't be rephrased safely (e.g. it says "I" or "my" again later), the original words are
 * kept verbatim after a neutral lead-in. Nothing is added: no extra praise, no extra criticism.
 * The paragraph is recomputed from the stored answers every time it is shown.
 */

export interface ComposeInput { reviewerName: string; pronouns?: string | null; enjoyed: string; suggestion: string }

const FIRST_PERSON = /\b(i|me|my|mine|myself|i'm|i've|i'd|i'll|im|ive)\b/i
const PAST: Record<string, string> = { love: 'loved', like: 'liked', enjoy: 'enjoyed', appreciate: 'appreciated', adore: 'adored' }
const IMPERATIVE = new Set(['add', 'include', 'make', 'try', 'use', 'consider', 'put', 'change', 'create', 'give', 'let', 'show', 'improve', 'expand', 'increase', 'reduce', 'fix', 'adjust', 'allow', 'update', 'remove', 'offer', 'provide', 'incorporate', 'integrate', 'explore', 'enable', 'maybe add', 'organize', 'simplify', 'shorten', 'lengthen', 'clarify', 'label', 'move', 'speed', 'slow', 'brighten', 'emphasize', 'highlight', 'build', 'design', 'develop', 'insert', 'link', 'polish', 'rework', 'swap', 'turn', 'keep'])

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const endPunct = (s: string) => (/[.!?…]["'”’)]*$/.test(s) ? s : `${s}.`)
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/** "she/her" → "She", "he/him" → "He", "they/them" → "They"; anything else → null (neutral phrasing is used). */
export function subjectPronoun(p?: string | null): string | null {
  const m = (p ?? '').trim().toLowerCase().match(/^(she|he|they)\b/)
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : null
}

export function composeEnjoyed(name: string, raw: string): string {
  const text = oneLine(raw)
  const tryRewrite = (re: RegExp, build: (m: RegExpMatchArray) => string): string | null => {
    const m = text.match(re)
    if (!m) return null
    const rest = text.slice(m[0].length)
    if (FIRST_PERSON.test(rest)) return null
    return endPunct(build(m) + rest)
  }
  return (
    tryRewrite(/^i (really |absolutely |truly |especially |just |definitely |honestly |genuinely )?(loved|love|liked|like|enjoyed|enjoy|appreciated|appreciate|adored|adore)\b/i,
      (m) => `${name} ${(m[1] ?? '').toLowerCase()}${PAST[m[2].toLowerCase()] ?? m[2].toLowerCase()}`) ??
    tryRewrite(/^i thought\b/i, () => `${name} thought`) ??
    tryRewrite(/^i think\b/i, () => `${name} thinks`) ??
    tryRewrite(/^i was (really |very |so |super |truly )?(impressed|amazed|blown away|surprised)\b/i, (m) => `${name} was ${(m[1] ?? '').toLowerCase()}${m[2].toLowerCase()}`) ??
    tryRewrite(/^my (favou?rite) (part|thing|feature|section|detail) (was|is)\b/i, (m) => `${name}'s ${m[1].toLowerCase()} ${m[2].toLowerCase()} ${m[3].toLowerCase()}`) ??
    tryRewrite(/^what i (loved|liked|enjoyed) (the )?most (was|is)\b/i, (m) => `What ${name} ${m[1].toLowerCase()} ${m[2] ? 'the ' : ''}most ${m[3].toLowerCase()}`) ??
    endPunct(`What ${name} enjoyed most: ${lcFirst(text)}`)
  )
}

export function composeSuggestion(raw: string, pronouns?: string | null): string {
  const text = oneLine(raw)
  const subj = subjectPronoun(pronouns)
  const sug = text.match(/^i (would |'d |might |also )?(suggest|recommend)(ed)?\b\s*/i)
  if (sug) {
    const rest = text.slice(sug[0].length)
    if (rest && !FIRST_PERSON.test(rest)) return endPunct(subj ? `${subj} suggested ${rest}` : `One suggestion was ${rest}`)
  }
  if (!FIRST_PERSON.test(text)) {
    const could = text.match(/^you (could|should|might|can)\b/i)
    if (could) return endPunct(`One suggestion was that ${lcFirst(text)}`)
    const words = text.split(' ')
    const first = words[0].toLowerCase().replace(/[^a-z]/g, '')
    if (IMPERATIVE.has(first) && words.length > 1) return endPunct(`One suggestion was to ${lcFirst(text)}`)
  }
  return endPunct(`One idea to make it even better: ${lcFirst(text)}`)
}

export function composeComment(i: ComposeInput): string {
  return `${composeEnjoyed(i.reviewerName, i.enjoyed)} ${composeSuggestion(i.suggestion, i.pronouns)}`
}
