/**
 * Minimal, dependency-light .xlsx reader (an .xlsx file is a zip of XML parts).
 * Used by the Node import script AND by the instructor dashboard in the browser, so both
 * read the spreadsheet in exactly the same way. Reads cell values only (no formulas, no styles).
 */
import { unzipSync, strFromU8 } from 'fflate'

export type Cell = string | number | boolean | null
export interface Sheet { name: string; rows: Cell[][] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decodeXml(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
}

/** Concatenate every <t> run inside a shared-string / inline-string item (handles rich text). */
function textRuns(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? '')
  return out
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`))
  return m ? decodeXml(m[1]) : undefined
}

export function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function resolveTarget(target: string): string {
  const t = target.replace(/^\//, '')
  return t.startsWith('xl/') ? t : `xl/${t}`
}

export function readWorkbook(data: Uint8Array): Sheet[] {
  const files = unzipSync(data)
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : undefined)
  const workbook = get('xl/workbook.xml')
  if (!workbook) throw new Error('This file is not an Excel workbook (xl/workbook.xml missing).')
  const rels = get('xl/_rels/workbook.xml.rels') ?? ''
  const relTarget = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'); const target = attr(m[0], 'Target')
    if (id && target) relTarget.set(id, resolveTarget(target))
  }
  const shared: string[] = []
  const sst = get('xl/sharedStrings.xml')
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]))

  const sheets: Sheet[] = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], 'name') ?? ''
    const rid = attr(m[0], 'r:id')
    const path = rid ? relTarget.get(rid) : undefined
    const xml = path ? get(path) : undefined
    if (!xml) { sheets.push({ name, rows: [] }); continue }
    const rows: Cell[][] = []
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rowAttrs = r[1] ?? r[3] ?? ''
      const rIndex = Number(attr(`<row ${rowAttrs}`, 'r') ?? rows.length + 1) - 1
      const row: Cell[] = []
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c ${c[1]}`
        const ref = attr(tag, 'r') ?? ''
        const type = attr(tag, 't')
        const body = c[2] ?? ''
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        let value: Cell = null
        if (type === 's') value = v !== undefined ? shared[Number(v)] ?? null : null
        else if (type === 'inlineStr') value = textRuns(body)
        else if (type === 'str') value = v !== undefined ? decodeXml(v) : null
        else if (type === 'b') value = v === '1'
        else if (v !== undefined) value = Number(v)
        row[ref ? colIndex(ref) : row.length] = value
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null
      rows[rIndex] = row
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
    sheets.push({ name, rows })
  }
  return sheets
}
