import type { Student } from '../../shared/roster.ts'

/** 6 desks per row; Section 01 = 6+6+6+6+4 (28), Section 02 = 6×5 (30). Row 0 is nearest the front. */
export const COLS = 6
export const COL_GAP = 2.05
export const ROW_GAP = 2.45
export const AISLE = 3.2

export interface Seat { student: Student; row: number; col: number; x: number; z: number }

export function seatGrid(section: Student[]): { row: number; col: number }[] {
  const n = section.length
  const rows = Math.ceil(n / COLS)
  const out: { row: number; col: number }[] = []
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(COLS, n - r * COLS)
    const offset = (COLS - inRow) / 2
    for (let c = 0; c < inRow; c++) out.push({ row: r, col: c + offset })
  }
  return out
}

/**
 * 3D positions. The camera starts at the FRONT (negative z) looking toward the back wall, so it sees faces.
 * Screen-left is +x from that viewpoint → Section 01 sits at +x, Section 02 at −x.
 */
export function seats3d(students: Student[]): Seat[] {
  const width = (COLS - 1) * COL_GAP
  const out: Seat[] = []
  for (const [sec, sign] of [['01', 1], ['02', -1]] as const) {
    const list = students.filter((s) => s.section === sec).sort((a, b) => a.position - b.position)
    const center = sign * (width / 2 + AISLE / 2)
    seatGrid(list).forEach((g, i) => {
      // col 0 is the screen-left desk of each section
      out.push({ student: list[i], row: g.row, col: g.col, x: center + (width / 2 - g.col * COL_GAP), z: g.row * ROW_GAP })
    })
  }
  return out
}
