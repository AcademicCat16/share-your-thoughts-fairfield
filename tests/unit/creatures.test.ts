import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREATURES } from '../../shared/creatures.ts'
import { CATEGORIES } from '../../shared/creatureTypes.ts'
import { creatureOrder } from '../../shared/roster.ts'

test('58 creatures with unique ids, names, colours, looks and idle animations', () => {
  assert.equal(CREATURES.length, 58)
  const uniq = (f: (c: (typeof CREATURES)[number]) => string) => new Set(CREATURES.map(f)).size
  assert.equal(uniq((c) => c.id), 58)
  assert.equal(uniq((c) => c.name.toLowerCase()), 58)
  assert.equal(uniq((c) => c.look.color.toLowerCase()), 58)
  assert.equal(uniq((c) => `${c.look.body}|${c.look.ears}|${c.look.tail}|${c.look.accessory}`), 58)
  assert.equal(uniq((c) => `${c.idle.motion}|${c.idle.speed}|${c.idle.amount}`), 58)
  for (const c of CREATURES) {
    assert.ok(CATEGORIES.includes(c.category))
    assert.ok(c.name && c.personality && c.ability && c.description, c.id)
  }
})

test('creature hand-out order is fixed (stable across runs and machines)', () => {
  const ids = CREATURES.map((c) => c.id)
  assert.deepEqual(creatureOrder(ids), creatureOrder(ids))
  assert.notDeepEqual(creatureOrder(ids), ids)
  assert.equal(new Set(creatureOrder(ids)).size, 58)
})
