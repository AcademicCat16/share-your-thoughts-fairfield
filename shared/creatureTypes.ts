/** Original classroom mascots. Rendered from these parameters as SVG (2D, modal) and as simple 3D primitives. */
export const CATEGORIES = ['Fire', 'Water', 'Forest', 'Electric', 'Crystal', 'Cloud', 'Cosmic', 'Ocean', 'Mechanical', 'Floral'] as const
export type Category = (typeof CATEGORIES)[number]

export type Body = 'round' | 'pear' | 'bean' | 'tall' | 'blob' | 'square'
export type Ears = 'cat' | 'bunny' | 'round' | 'leaf' | 'flame' | 'fin' | 'antenna' | 'horns' | 'crystal' | 'puff' | 'droop' | 'none'
export type Tail = 'none' | 'flame' | 'leaf' | 'fish' | 'bolt' | 'swirl' | 'puff' | 'star' | 'gear'
export type Eyes = 'round' | 'sleepy' | 'sparkle' | 'wide' | 'happy'
export type Mouth = 'smile' | 'open' | 'cat' | 'grin'
export type Pattern = 'none' | 'spots' | 'stripes' | 'stars' | 'patch'
export type Accessory = 'none' | 'scarf' | 'bowtie' | 'flower' | 'goggles' | 'leafhat' | 'crown' | 'glasses' | 'headphones' | 'beanie' | 'bandana' | 'pilgrimhat'
export type Wings = 'none' | 'tiny' | 'feather' | 'fairy'
export type IdleMotion = 'bob' | 'sway' | 'breathe' | 'hop' | 'float' | 'wiggle' | 'tilt' | 'spin'
export type HoverMove = 'wave' | 'raise' | 'bounce' | 'sparkle' | 'spin' | 'float'

export interface CreatureLook {
  body: Body
  /** Main fur/skin colour, belly colour, accent (ears/tail/pattern) — hex like "#ffb3c7". */
  color: string
  belly: string
  accent: string
  ears: Ears
  tail: Tail
  eyes: Eyes
  mouth: Mouth
  pattern: Pattern
  accessory: Accessory
  wings: Wings
}

export interface CreatureSpec {
  /** "c01" … "c58" — stable forever; roster.json stores this id per student. */
  id: string
  name: string
  category: Category
  personality: string
  ability: string
  description: string
  look: CreatureLook
  /** Idle loop: motion type + speed (cycles per second, 0.3–1.6) + amount (0.2–1.0). The triple is unique per creature. */
  idle: { motion: IdleMotion; speed: number; amount: number }
  hover: HoverMove
}
