/**
 * Student access codes (Live mode). Random XXXX-XXXX-XXXX from a 31-character alphabet without look-alikes
 * (≈59 bits). Only SHA-256 of the normalised code is stored; the SQL function redeem_access_code normalises and
 * hashes the same way (see supabase/CONTRACT.md). Node-only helpers (hashing uses node:crypto).
 */
import { createHash, randomInt } from 'node:crypto'

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LENGTH = 12

export function newAccessCode(): string {
  let s = ''
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** Upper-case, drop everything but A–Z/0–9, re-dash when exactly 12 characters remain. */
export function normalizeAccessCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return s.length === CODE_LENGTH ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : s
}

export function hashAccessCode(raw: string): string {
  return createHash('sha256').update(normalizeAccessCode(raw), 'utf8').digest('hex')
}
