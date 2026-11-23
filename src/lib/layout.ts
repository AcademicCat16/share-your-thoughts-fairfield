import type { Student } from '../../shared/roster.ts'

/**
 * Seat layout. MKTG 2241 (unchanged from the first demo): 6 desks per row; Section 01 = 6+6+6+6+4 (28),
 * Section 02 = 6×5 (30). MKTG 1101: two blocks of 14 either side of the aisle, 5 per row (5+5+4).
 * Row 0 is nearest the front.
 */
export const COLS = 6
export const COL_GAP = 2.05
export const ROW_GAP = 2.45
export const AISLE = 3.2

export interface Seat { student: Student; row: number; col: number; x: number; z: number; block: 0 | 1 }

export function seatGrid(n: number, cols = COLS): { row: number; col: number }[] {
  const rows = Math.ceil(n / cols)
  const out: { row: number; col: number }[] = []
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols)
    const offset = (cols - inRow) / 2
    for (let c = 0; c < inRow; c++) out.push({ row: r, col: c + offset })
  }
  return out
}

/** The two blocks of desks in a room: [screen-left block, screen-right block] from the front camera. */
export function blocks(students: Student[]): { list: Student[]; cols: number }[] {
  const sorted = [...students].sort((a, b) => a.section.localeCompare(b.section) || a.position - b.position)
  if (sorted.every((s) => s.course === '2241')) {
    return [{ list: sorted.filter((s) => s.section === '01'), cols: COLS }, { list: sorted.filter((s) => s.section === '02'), cols: COLS }]
  }
  const half = Math.ceil(sorted.length / 2)
  return [{ list: sorted.slice(0, half), cols: 5 }, { list: sorted.slice(half), cols: 5 }]
}

/**
 * 3D positions. The camera starts at the FRONT (negative z) looking toward the back wall, so it sees faces.
 * Screen-left is +x from that viewpoint → block 0 sits at +x, block 1 at −x.
 */
export function seats3d(students: Student[]): Seat[] {
  const out: Seat[] = []
  blocks(students).forEach(({ list, cols }, b) => {
    const sign = b === 0 ? 1 : -1
    const width = (COLS - 1) * COL_GAP
    const center = sign * (width / 2 + AISLE / 2)
    const w = (cols - 1) * COL_GAP
    seatGrid(list.length, cols).forEach((g, i) => {
      out.push({ student: list[i], row: g.row, col: g.col, block: b as 0 | 1, x: center + (w / 2 - g.col * COL_GAP), z: g.row * ROW_GAP })
    })
  })
  return out
}
