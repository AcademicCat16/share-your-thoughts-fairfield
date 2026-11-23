import type { CreatureSpec } from './creatureTypes.ts'

/**
 * 28 original "Harvest Market Fair" mascots for MKTG 1101 (Principles of Marketing).
 * Ids c59–c86 continue after the 58 in creatures.ts and are stable forever (roster.json stores them).
 */
export const CREATURES_1101: CreatureSpec[] = [
  // ── Fire ──────────────────────────────────────────────
  {
    id: 'c59', name: 'Lanternip', category: 'Fire',
    personality: 'Glowing and welcoming',
    ability: 'Stall Light — keeps every market booth bright long after sunset',
    description: 'Lanternip hangs out by the fair entrance and lights the way to every stall. It says a good first impression starts with a warm glow.',
    look: { body: 'pear', color: '#ffb27d', belly: '#fff2e4', accent: '#f0783a', ears: 'puff', tail: 'star', eyes: 'sparkle', mouth: 'smile', pattern: 'none', accessory: 'scarf', wings: 'none' },
    idle: { motion: 'bob', speed: 0.72, amount: 0.42 }, hover: 'sparkle',
  },
  {
    id: 'c60', name: 'Toffeeflick', category: 'Fire',
    personality: 'Sweet and persuasive',
    ability: 'Free Sample — hands out warm toffee so everyone can try before they buy',
    description: 'Toffeeflick runs the candy stall and never lets anyone leave empty-handed. It believes a happy customer is the best advertisement.',
    look: { body: 'round', color: '#f4c08e', belly: '#fff6ea', accent: '#d9822f', ears: 'horns', tail: 'swirl', eyes: 'happy', mouth: 'grin', pattern: 'spots', accessory: 'bowtie', wings: 'none' },
    idle: { motion: 'wiggle', speed: 1.08, amount: 0.47 }, hover: 'bounce',
  },
  {
    id: 'c61', name: 'Kettlepop', category: 'Fire',
    personality: 'Bubbly and energetic',
    ability: 'Pop-Up Shop — opens a cheerful stand anywhere in seconds',
    description: 'Kettlepop stirs a giant pot of sweet-and-salty corn at the fair. Every pop sounds like a brand-new idea arriving.',
    look: { body: 'square', color: '#ffc9a3', belly: '#fff8f0', accent: '#f2944f', ears: 'flame', tail: 'puff', eyes: 'wide', mouth: 'open', pattern: 'stripes', accessory: 'bandana', wings: 'none' },
    idle: { motion: 'hop', speed: 1.33, amount: 0.58 }, hover: 'spin',
  },

  // ── Water ─────────────────────────────────────────────
  {
    id: 'c62', name: 'Bobbleapple', category: 'Water',
    personality: 'Playful and splashy',
    ability: 'Apple Bob — always comes up with the juiciest idea in the barrel',
    description: 'Bobbleapple runs the apple-bobbing tub at the harvest fair. It giggles every time it surfaces with a fresh, shiny prize.',
    look: { body: 'blob', color: '#a4d4ee', belly: '#effaff', accent: '#4f9fd6', ears: 'leaf', tail: 'fish', eyes: 'happy', mouth: 'open', pattern: 'spots', accessory: 'flower', wings: 'none' },
    idle: { motion: 'float', speed: 0.62, amount: 0.53 }, hover: 'float',
  },
  {
    id: 'c63', name: 'Steeplet', category: 'Water',
    personality: 'Calm and patient',
    ability: 'Slow Steep — lets a good plan brew until it is just right',
    description: 'Steeplet serves warm spiced tea at the quietest stall in the market. It knows the best customer conversations take a little time.',
    look: { body: 'tall', color: '#b3dce9', belly: '#f1fbfe', accent: '#3d9cbf', ears: 'droop', tail: 'swirl', eyes: 'sleepy', mouth: 'smile', pattern: 'none', accessory: 'glasses', wings: 'none' },
    idle: { motion: 'breathe', speed: 0.38, amount: 0.62 }, hover: 'raise',
  },
  {
    id: 'c64', name: 'Brookbasket', category: 'Water',
    personality: 'Helpful and organised',
    ability: 'Full Basket — carries everyone\'s shopping list without dropping a thing',
    description: 'Brookbasket paddles goods down the fairground stream to every booth. It never forgets who ordered what.',
    look: { body: 'bean', color: '#9cc7e6', belly: '#eaf4fc', accent: '#3a7fc4', ears: 'fin', tail: 'leaf', eyes: 'round', mouth: 'cat', pattern: 'patch', accessory: 'beanie', wings: 'none' },
    idle: { motion: 'sway', speed: 0.88, amount: 0.38 }, hover: 'wave',
  },

  // ── Forest ────────────────────────────────────────────
  {
    id: 'c65', name: 'Gourdwick', category: 'Forest',
    personality: 'Proud and cheerful',
    ability: 'Prize Pumpkin — makes any display look like a blue-ribbon winner',
    description: 'Gourdwick grows the plumpest pumpkins at the fair and arranges them just so. It says presentation is half the harvest.',
    look: { body: 'round', color: '#f7c58b', belly: '#fff5e6', accent: '#d97b2b', ears: 'leaf', tail: 'swirl', eyes: 'round', mouth: 'grin', pattern: 'stripes', accessory: 'leafhat', wings: 'none' },
    idle: { motion: 'tilt', speed: 0.67, amount: 0.38 }, hover: 'raise',
  },
  {
    id: 'c66', name: 'Acornote', category: 'Forest',
    personality: 'Curious and careful',
    ability: 'Read the Label — always checks what is inside before choosing',
    description: 'Acornote reads every label at every stall and jots notes in a tiny leaf notebook. Friends ask it which jam is really homemade.',
    look: { body: 'pear', color: '#d4b48e', belly: '#f8efe3', accent: '#9c6b3c', ears: 'round', tail: 'puff', eyes: 'wide', mouth: 'smile', pattern: 'patch', accessory: 'glasses', wings: 'none' },
    idle: { motion: 'bob', speed: 0.52, amount: 0.33 }, hover: 'wave',
  },
  {
    id: 'c67', name: 'Hayloftle', category: 'Forest',
    personality: 'Easygoing and friendly',
    ability: 'Hayride Host — gives every newcomer a cozy tour of the fair',
    description: 'Hayloftle lives in the barn behind the market and loves greeting visitors. Its straw-coloured fluff always has a few stray leaves in it.',
    look: { body: 'blob', color: '#e8d48f', belly: '#fffaea', accent: '#b8962c', ears: 'droop', tail: 'puff', eyes: 'sleepy', mouth: 'cat', pattern: 'none', accessory: 'pilgrimhat', wings: 'none' },
    idle: { motion: 'sway', speed: 0.43, amount: 0.48 }, hover: 'float',
  },

  // ── Electric ──────────────────────────────────────────
  {
    id: 'c68', name: 'Jinglecoin', category: 'Electric',
    personality: 'Quick and upbeat',
    ability: 'Ka-Ching — rings a happy little bell whenever a fair deal is made',
    description: 'Jinglecoin buzzes from stall to stall making change in a flash. It thinks every price should be fair to the buyer and the seller.',
    look: { body: 'square', color: '#f5e07e', belly: '#fffbe3', accent: '#d6b31f', ears: 'antenna', tail: 'bolt', eyes: 'sparkle', mouth: 'grin', pattern: 'stars', accessory: 'bowtie', wings: 'none' },
    idle: { motion: 'hop', speed: 1.18, amount: 0.44 }, hover: 'bounce',
  },
  {
    id: 'c69', name: 'Zapricot', category: 'Electric',
    personality: 'Zippy and optimistic',
    ability: 'Bright Spark — charges up a sleepy brainstorm in one zap',
    description: 'Zapricot hangs from the orchard trees like a glowing little fruit. When it drops into a group, the ideas start crackling.',
    look: { body: 'bean', color: '#ffcf8a', belly: '#fff7e8', accent: '#f29a1d', ears: 'bunny', tail: 'bolt', eyes: 'happy', mouth: 'open', pattern: 'none', accessory: 'headphones', wings: 'tiny' },
    idle: { motion: 'wiggle', speed: 1.42, amount: 0.41 }, hover: 'spin',
  },
  {
    id: 'c70', name: 'Buzzbargain', category: 'Electric',
    personality: 'Friendly and thrifty',
    ability: 'Best Value — finds the deal that gives everyone the most for the least',
    description: 'Buzzbargain hums along the market aisles comparing prices. It loves sharing tips so nobody overpays for pumpkin bread.',
    look: { body: 'tall', color: '#eaea95', belly: '#fdfde8', accent: '#b9b42a', ears: 'antenna', tail: 'none', eyes: 'round', mouth: 'smile', pattern: 'stripes', accessory: 'goggles', wings: 'fairy' },
    idle: { motion: 'float', speed: 1.12, amount: 0.46 }, hover: 'sparkle',
  },

  // ── Crystal ───────────────────────────────────────────
  {
    id: 'c71', name: 'Glimmerjar', category: 'Crystal',
    personality: 'Gentle and thoughtful',
    ability: 'Perfect Preserve — keeps a good memory fresh all winter long',
    description: 'Glimmerjar sparkles on the top shelf of the preserves stall. It shines brightest when someone remembers a kind thing a classmate said.',
    look: { body: 'tall', color: '#d9c8f2', belly: '#f7f2fe', accent: '#9f7fd8', ears: 'crystal', tail: 'star', eyes: 'sparkle', mouth: 'smile', pattern: 'none', accessory: 'crown', wings: 'none' },
    idle: { motion: 'spin', speed: 0.47, amount: 0.36 }, hover: 'sparkle',
  },
  {
    id: 'c72', name: 'Honeyprism', category: 'Crystal',
    personality: 'Warm and honest',
    ability: 'Clear Promise — makes sure what is on the sign is what is in the jar',
    description: 'Honeyprism glows golden in the afternoon sun at the honey booth. It believes a brand is only as good as the promise it keeps.',
    look: { body: 'round', color: '#f6dc9e', belly: '#fffaec', accent: '#d8a634', ears: 'crystal', tail: 'none', eyes: 'round', mouth: 'cat', pattern: 'patch', accessory: 'flower', wings: 'tiny' },
    idle: { motion: 'breathe', speed: 0.73, amount: 0.52 }, hover: 'float',
  },
  {
    id: 'c73', name: 'Quillquartz', category: 'Crystal',
    personality: 'Creative and precise',
    ability: 'Sharp Slogan — writes a catchy sign for any stall in one try',
    description: 'Quillquartz paints the chalkboard signs at the market entrance. Its crystal ears chime softly when a phrase is just right.',
    look: { body: 'square', color: '#c5e3e1', belly: '#f0faf9', accent: '#5fada8', ears: 'crystal', tail: 'swirl', eyes: 'wide', mouth: 'grin', pattern: 'spots', accessory: 'beanie', wings: 'none' },
    idle: { motion: 'tilt', speed: 1.17, amount: 0.62 }, hover: 'raise',
  },

  // ── Cloud ─────────────────────────────────────────────
  {
    id: 'c74', name: 'Samplefluff', category: 'Cloud',
    personality: 'Generous and soft-spoken',
    ability: 'Taste Test — floats by with a bite-sized sample of every new idea',
    description: 'Samplefluff drifts over the fair carrying tiny trays of treats. It says the best way to win a friend is to let them try first.',
    look: { body: 'blob', color: '#e3e6f5', belly: '#fbfcff', accent: '#9aa3d6', ears: 'puff', tail: 'puff', eyes: 'happy', mouth: 'smile', pattern: 'none', accessory: 'scarf', wings: 'feather' },
    idle: { motion: 'float', speed: 0.36, amount: 0.67 }, hover: 'float',
  },
  {
    id: 'c75', name: 'Driftpie', category: 'Cloud',
    personality: 'Dreamy and kind',
    ability: 'Slice of Sky — shares a warm piece of pie with anyone feeling left out',
    description: 'Driftpie smells like cinnamon and fresh crust. It hovers over the bake-sale table making sure every slice is the same size.',
    look: { body: 'pear', color: '#f2dcd6', belly: '#fff8f6', accent: '#d39383', ears: 'round', tail: 'swirl', eyes: 'sleepy', mouth: 'cat', pattern: 'spots', accessory: 'pilgrimhat', wings: 'feather' },
    idle: { motion: 'sway', speed: 0.57, amount: 0.83 }, hover: 'wave',
  },
  {
    id: 'c76', name: 'Mistmarquee', category: 'Cloud',
    personality: 'Cheerful and attention-grabbing',
    ability: 'Grand Opening — rolls out a soft cloud banner for every new stall',
    description: 'Mistmarquee loves announcing things. It puffs welcome messages in the sky above the fair so nobody misses the fun.',
    look: { body: 'square', color: '#d3e7f0', belly: '#f5fbfe', accent: '#7fb2cc', ears: 'bunny', tail: 'none', eyes: 'sparkle', mouth: 'open', pattern: 'stars', accessory: 'headphones', wings: 'fairy' },
    idle: { motion: 'bob', speed: 0.93, amount: 0.57 }, hover: 'bounce',
  },

  // ── Cosmic ────────────────────────────────────────────
  {
    id: 'c77', name: 'Stargourd', category: 'Cosmic',
    personality: 'Wise and wonder-filled',
    ability: 'Big Picture — sees the whole market from high above',
    description: 'Stargourd glows softly over the pumpkin patch at night. It reminds friends to think about where their ideas fit in the bigger sky.',
    look: { body: 'round', color: '#c7b8ec', belly: '#f4f0fd', accent: '#7f62cf', ears: 'antenna', tail: 'star', eyes: 'sparkle', mouth: 'smile', pattern: 'stars', accessory: 'crown', wings: 'none' },
    idle: { motion: 'float', speed: 0.48, amount: 0.77 }, hover: 'sparkle',
  },
  {
    id: 'c78', name: 'Cometcrumb', category: 'Cosmic',
    personality: 'Speedy and sociable',
    ability: 'Word of Mouth — spreads good news across the fair in a single streak',
    description: 'Cometcrumb zooms between stalls leaving a trail of sparkly crumbs. Everyone hears about the best cider within minutes.',
    look: { body: 'bean', color: '#bcc6f2', belly: '#f0f3fe', accent: '#5a6fd4', ears: 'cat', tail: 'star', eyes: 'wide', mouth: 'grin', pattern: 'spots', accessory: 'goggles', wings: 'tiny' },
    idle: { motion: 'spin', speed: 1.27, amount: 0.53 }, hover: 'spin',
  },
  {
    id: 'c79', name: 'Moonmarrow', category: 'Cosmic',
    personality: 'Quiet and steady',
    ability: 'Harvest Moon — lights the late-night packing up so nobody gets lost',
    description: 'Moonmarrow rises over the fair just as the stalls close. It hums a sleepy tune while friends count their apples.',
    look: { body: 'blob', color: '#e1d3ef', belly: '#faf5fe', accent: '#a57fcb', ears: 'horns', tail: 'none', eyes: 'sleepy', mouth: 'smile', pattern: 'patch', accessory: 'beanie', wings: 'fairy' },
    idle: { motion: 'breathe', speed: 0.58, amount: 0.73 }, hover: 'float',
  },

  // ── Ocean ─────────────────────────────────────────────
  {
    id: 'c80', name: 'Cranberrel', category: 'Ocean',
    personality: 'Bouncy and tart',
    ability: 'Bog Bounce — floats a whole harvest of bright ideas to the surface',
    description: 'Cranberrel lives in the cranberry bog at the edge of the fair. It rolls around in the water until every berry bobs up shiny and red.',
    look: { body: 'round', color: '#f3a9b6', belly: '#fff0f3', accent: '#d95870', ears: 'fin', tail: 'fish', eyes: 'happy', mouth: 'open', pattern: 'spots', accessory: 'bandana', wings: 'none' },
    idle: { motion: 'hop', speed: 0.83, amount: 0.62 }, hover: 'bounce',
  },
  {
    id: 'c81', name: 'Tidetally', category: 'Ocean',
    personality: 'Careful and fair',
    ability: 'Count the Catch — knows exactly how many customers each stall served',
    description: 'Tidetally keeps a neat shell-bead tally at the seafood chowder stand. It loves turning numbers into stories friends can understand.',
    look: { body: 'tall', color: '#9fd9d2', belly: '#ecfaf8', accent: '#3aa597', ears: 'none', tail: 'fish', eyes: 'round', mouth: 'smile', pattern: 'stripes', accessory: 'glasses', wings: 'none' },
    idle: { motion: 'sway', speed: 1.23, amount: 0.57 }, hover: 'raise',
  },

  // ── Mechanical ────────────────────────────────────────
  {
    id: 'c82', name: 'Scalesby', category: 'Mechanical',
    personality: 'Fair-minded and precise',
    ability: 'Honest Weight — makes sure every pound of apples is a true pound',
    description: 'Scalesby clanks happily beside the produce bins weighing everything twice. It thinks trust is the most valuable thing a market sells.',
    look: { body: 'square', color: '#c9cfd8', belly: '#f3f5f8', accent: '#7c8799', ears: 'round', tail: 'gear', eyes: 'round', mouth: 'smile', pattern: 'patch', accessory: 'pilgrimhat', wings: 'none' },
    idle: { motion: 'tilt', speed: 0.53, amount: 0.72 }, hover: 'wave',
  },
  {
    id: 'c83', name: 'Cogcart', category: 'Mechanical',
    personality: 'Busy and dependable',
    ability: 'Right Place — rolls the right goods to the right stall at the right time',
    description: 'Cogcart squeaks along the fair paths delivering pies, cider and gourds. Its little gears whir faster when the crowds arrive.',
    look: { body: 'bean', color: '#d8c7b4', belly: '#f8f2eb', accent: '#9b7a58', ears: 'antenna', tail: 'gear', eyes: 'wide', mouth: 'grin', pattern: 'none', accessory: 'bandana', wings: 'none' },
    idle: { motion: 'wiggle', speed: 0.78, amount: 0.73 }, hover: 'spin',
  },
  {
    id: 'c84', name: 'Pricklock', category: 'Mechanical',
    personality: 'Thoughtful and fair',
    ability: 'Price Check — finds a price that feels right for everyone at the fair',
    description: 'Pricklock ticks quietly as it sorts little paper price tags. It always asks what something is worth to the person buying it.',
    look: { body: 'pear', color: '#b9d6c4', belly: '#eff8f2', accent: '#5c9a74', ears: 'bunny', tail: 'gear', eyes: 'happy', mouth: 'cat', pattern: 'stripes', accessory: 'goggles', wings: 'none' },
    idle: { motion: 'bob', speed: 1.17, amount: 0.67 }, hover: 'raise',
  },

  // ── Floral ────────────────────────────────────────────
  {
    id: 'c85', name: 'Bouquette', category: 'Floral',
    personality: 'Charming and artistic',
    ability: 'Window Display — arranges any stall so it blooms with colour',
    description: 'Bouquette tucks fresh flowers into every corner of the market. It says a stall should look as good as it smells.',
    look: { body: 'tall', color: '#f6bfd8', belly: '#fff2f8', accent: '#e06fa3', ears: 'leaf', tail: 'leaf', eyes: 'sparkle', mouth: 'smile', pattern: 'spots', accessory: 'flower', wings: 'fairy' },
    idle: { motion: 'sway', speed: 0.68, amount: 0.92 }, hover: 'sparkle',
  },
  {
    id: 'c86', name: 'Sunflourish', category: 'Floral',
    personality: 'Sunny and loyal',
    ability: 'Repeat Visit — makes friends so happy they come back every week',
    description: 'Sunflourish greets regulars by name at the sunflower stand. It turns to face whoever is talking, just like a flower follows the sun.',
    look: { body: 'blob', color: '#ffe08f', belly: '#fffbe9', accent: '#e8ad1c', ears: 'puff', tail: 'star', eyes: 'happy', mouth: 'grin', pattern: 'none', accessory: 'leafhat', wings: 'none' },
    idle: { motion: 'tilt', speed: 0.87, amount: 0.27 }, hover: 'bounce',
  },
]
