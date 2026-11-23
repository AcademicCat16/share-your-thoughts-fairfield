import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREATURES } from '../../shared/creatures.ts'
import { CREATURES_1101 } from '../../shared/creatures1101.ts'
import { CATEGORIES } from '../../shared/creatureTypes.ts'

const ALL = [...CREATURES, ...CREATURES_1101]
type C = (typeof ALL)[number]

const assertUnique = (label: string, f: (c: C) => string) => {
  const seen = new Map<string, string>()
  for (const c of ALL) {
    const k = f(c)
    assert.ok(!seen.has(k), `${label} "${k}" shared by ${seen.get(k)} and ${c.id}`)
    seen.set(k, c.id)
  }
}

test('MKTG 1101 has exactly 28 creatures, ids c59..c86 in order', () => {
  assert.equal(CREATURES_1101.length, 28)
  assert.deepEqual(
    CREATURES_1101.map((c) => c.id),
    Array.from({ length: 28 }, (_, i) => `c${59 + i}`),
  )
})

test('every 1101 creature has a valid category and non-empty text', () => {
  for (const c of CREATURES_1101) {
    assert.ok(CATEGORIES.includes(c.category), c.id)
    for (const f of [c.name, c.personality, c.ability, c.description]) assert.ok(f.trim().length > 0, c.id)
    assert.ok(c.idle.speed >= 0.3 && c.idle.speed <= 1.6, `${c.id} speed`)
    assert.ok(c.idle.amount >= 0.2 && c.idle.amount <= 1.0, `${c.id} amount`)
  }
})

test('ids, names, colours, looks and idle triples are unique across all 86', () => {
  assert.equal(ALL.length, 86)
  assertUnique('id', (c) => c.id)
  assertUnique('name', (c) => c.name.toLowerCase())
  assertUnique('color', (c) => c.look.color.toLowerCase())
  assertUnique('look', (c) => `${c.look.body}|${c.look.ears}|${c.look.tail}|${c.look.accessory}`)
  assertUnique('idle', (c) => `${c.idle.motion}|${c.idle.speed}|${c.idle.amount}`)
})

test('no 1101 name equals an existing creature name', () => {
  const existing = new Set(CREATURES.map((c) => c.name.toLowerCase()))
  for (const c of CREATURES_1101) assert.ok(!existing.has(c.name.toLowerCase()), c.name)
})
