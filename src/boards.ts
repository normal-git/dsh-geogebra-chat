/**
 * Board store: one immutable snapshot board per record.
 *
 * The Host owns every board's XML, sheet and `.ggb`, so the Agent never needs a
 * mounted iframe to read a board. The browser renders the current XML and
 * reports back once (creation) and on user edits.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** One object on a board, as GeoGebra describes it. */
export interface SheetEntry {
  readonly label: string
  readonly type: string
  readonly definition: string
  /** One-line rendering: `A(0,0)` or `c=Circle(A,B)`. */
  readonly text: string
  /** Free-point coordinates, when the object is a point. */
  readonly x?: number
  readonly y?: number
  /** `getValueString` snapshot, used by `inspect(detail: 'value')`. */
  readonly value?: string
}

/** One immutable board. */
export interface BoardRecord {
  boardId: string
  sessionId: string
  name: string
  appName: string
  /** `creating` = waiting for the card; `draft` = editable this turn; `final` = frozen. */
  status: 'creating' | 'draft' | 'final'
  /** Turn that created the board; a draft can only be amended while it is current. */
  turn: number
  /** Bumped by `amend` so the card re-runs the construction. */
  attempt: number
  /** One-line intent from the model, shown on the card in the transcript body. */
  caption?: string
  /** Construction the card starts from (`from` board, or undefined for blank). */
  baseXml?: string
  /** Commands the card executes once, in order. */
  commands: string[]
  originalXml?: string
  currentXml?: string
  originalGgbBase64?: string
  currentGgbBase64?: string
  sheet?: SheetEntry[]
  originalSheet?: SheetEntry[]
  failed: Array<{ command: string, error?: string }>
  /** Commands that returned false without an error (usually style commands that did apply). */
  warnings: Array<{ command: string, note: string }>
  createdAt: number
  updatedAt: number
}

/** What the card receives to render one board. */
export interface BoardPayload {
  boardId: string
  name: string
  appName: string
  status: 'creating' | 'draft' | 'final'
  turn: number
  attempt: number
  caption?: string
  baseXml?: string
  currentXml?: string
  originalXml?: string
  commands: string[]
}

/** Bounded per-board budget (XML + both `.ggb` copies). */
const MAX_BOARD_BYTES = 4 * 1024 * 1024
/** Bounded boards per session. */
const MAX_BOARDS = 200

/** Two-decimal, trailing-zero-free number. */
export function fmt(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '?'
  const rounded = Math.round(value * 100) / 100
  return String(rounded)
}

/** Render a sheet as one line per object (the Agent-facing form). */
export function sheetText(sheet: readonly SheetEntry[] | undefined): string {
  if (sheet === undefined || sheet.length === 0) return '(空)'
  return sheet.map(entry => entry.text).join('  ')
}

/** Names only. */
export function labelsOf(sheet: readonly SheetEntry[] | undefined): string[] {
  return (sheet ?? []).map(entry => entry.label)
}

/** Object-level difference between two sheets. */
export function diffSheets(before: readonly SheetEntry[] | undefined, after: readonly SheetEntry[] | undefined): {
  added: SheetEntry[]
  removed: string[]
  moved: string[]
  changed: string[]
} {
  const old = new Map((before ?? []).map(entry => [entry.label, entry]))
  const now = new Map((after ?? []).map(entry => [entry.label, entry]))
  const added = (after ?? []).filter(entry => !old.has(entry.label))
  const removed = (before ?? []).filter(entry => !now.has(entry.label)).map(entry => entry.label)
  const moved: string[] = []
  const changed: string[] = []
  for (const [label, entry] of now) {
    const previous = old.get(label)
    if (previous === undefined) continue
    if (entry.x !== undefined && previous.x !== undefined) {
      if (fmt(entry.x) !== fmt(previous.x) || fmt(entry.y) !== fmt(previous.y)) {
        moved.push(`${label} → (${fmt(entry.x)}, ${fmt(entry.y)})`)
      }
    } else if (entry.definition !== previous.definition) {
      changed.push(label)
    }
  }
  return { added, removed, moved, changed }
}

/** One-line human description of a diff, or empty when nothing changed. */
export function diffText(before: readonly SheetEntry[] | undefined, after: readonly SheetEntry[] | undefined): string {
  const diff = diffSheets(before, after)
  const parts: string[] = []
  if (diff.added.length > 0) parts.push(`新增 ${diff.added.map(entry => entry.text).join('、')}`)
  if (diff.removed.length > 0) parts.push(`删除 ${diff.removed.join('、')}`)
  if (diff.moved.length > 0) parts.push(`移动 ${diff.moved.join('、')}`)
  if (diff.changed.length > 0) parts.push(`定义变化 ${diff.changed.join('、')}`)
  return parts.join('；')
}

/** Persistent, session-scoped board repository. */
export class BoardStore {
  readonly #root: string
  readonly #sessions = new Map<string, Map<string, BoardRecord>>()
  readonly #waiters = new Map<string, Array<(record: BoardRecord) => void>>()

  /**
   * @param home - Harness home directory.
   */
  constructor(home: string = process.env.DSH_HOME ?? join(homedir(), '.dsh')) {
    this.#root = join(home, 'geogebra', 'boards')
  }

  #dir(sessionId: string): string {
    return join(this.#root, encodeURIComponent(sessionId))
  }

  #file(sessionId: string, boardId: string): string {
    return join(this.#dir(sessionId), `${boardId}.json`)
  }

  #load(sessionId: string): Map<string, BoardRecord> {
    const cached = this.#sessions.get(sessionId)
    if (cached !== undefined) return cached
    const boards = new Map<string, BoardRecord>()
    const dir = this.#dir(sessionId)
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const record = JSON.parse(readFileSync(join(dir, file), 'utf8')) as BoardRecord
          if (typeof record.boardId === 'string') boards.set(record.boardId, record)
        } catch {
          // Ignore a corrupt board file; the session keeps its other boards.
        }
      }
    }
    this.#sessions.set(sessionId, boards)
    return boards
  }

  #persist(record: BoardRecord): void {
    try {
      mkdirSync(this.#dir(record.sessionId), { recursive: true })
      const target = this.#file(record.sessionId, record.boardId)
      const temporary = `${target}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(record))
      renameSync(temporary, target)
    } catch {
      // Best effort: the in-memory record still serves this run.
    }
  }

  /** Create one board, allocating the session-local id and a unique name. */
  create(input: {
    sessionId: string
    name: string
    appName: string
    caption?: string
    baseXml?: string
    commands: string[]
    turn: number
  }): BoardRecord {
    const boards = this.#load(input.sessionId)
    if (boards.size >= MAX_BOARDS) throw new Error(`this session already has ${MAX_BOARDS} boards`)
    let index = boards.size + 1
    while (boards.has(`b${index}`)) index += 1
    const taken = new Set([...boards.values()].map(record => record.name))
    let name = input.name.trim() || `板${index}`
    if (taken.has(name)) {
      let suffix = 2
      while (taken.has(`${name} (${suffix})`)) suffix += 1
      name = `${name} (${suffix})`
    }
    const record: BoardRecord = {
      boardId: `b${index}`,
      sessionId: input.sessionId,
      name,
      appName: input.appName,
      status: 'creating',
      turn: input.turn,
      attempt: 0,
      ...input.caption === undefined ? {} : { caption: input.caption },
      ...input.baseXml === undefined ? {} : { baseXml: input.baseXml },
      commands: input.commands,
      failed: [],
      warnings: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    boards.set(record.boardId, record)
    this.#persist(record)
    return record
  }

  /** Freeze every draft created before `turn`. */
  finalizeBefore(sessionId: string, turn: number): string[] {
    const finalized: string[] = []
    for (const record of this.#load(sessionId).values()) {
      if (record.status === 'draft' && record.turn < turn) {
        record.status = 'final'
        record.updatedAt = Date.now()
        this.#persist(record)
        finalized.push(record.boardId)
      }
    }
    return finalized
  }

  /**
   * Re-run a draft with new commands on top of its current construction.
   *
   * The base for a re-run is the board's *current* XML, not the original base:
   * the model may resend only the failed commands, and existing objects stay
   * (GeoGebra redefines a label when the full list is resent, which is also
   * fine). Only the current turn may amend; afterwards the board is frozen.
   */
  amend(sessionId: string, reference: string, commands: string[], turn: number, caption?: string): BoardRecord {
    const record = this.get(sessionId, reference)
    if (record === undefined) throw new Error(`board "${reference}" not found`)
    if (record.status === 'creating') throw new Error(`${record.boardId} 尚未回填，稍后再试。`)
    if (record.status === 'final' || record.turn !== turn) {
      throw new Error(`${record.boardId} 已经定稿，不能再修改；请基于它 geogebra_create 一张新板。`)
    }
    if (record.currentXml !== undefined) record.baseXml = record.currentXml
    if (caption !== undefined && caption.trim() !== '') record.caption = caption.trim()
    record.commands = commands
    record.attempt += 1
    record.status = 'creating'
    record.updatedAt = Date.now()
    this.#persist(record)
    return record
  }

  /** Mark one draft final. */
  commit(sessionId: string, reference: string): BoardRecord {
    const record = this.get(sessionId, reference)
    if (record === undefined) throw new Error(`board "${reference}" not found`)
    record.status = 'final'
    record.updatedAt = Date.now()
    this.#persist(record)
    return record
  }

  /** Resolve a board by id or by name. */
  get(sessionId: string, reference: string): BoardRecord | undefined {
    const boards = this.#load(sessionId)
    const byId = boards.get(reference)
    if (byId !== undefined) return byId
    for (const record of boards.values()) {
      if (record.name === reference) return record
    }
    return undefined
  }

  /** All boards of one session, oldest first. */
  list(sessionId: string): BoardRecord[] {
    return [...this.#load(sessionId).values()].sort((left, right) => left.createdAt - right.createdAt)
  }

  /** Card render payload. */
  payload(record: BoardRecord): BoardPayload {
    return {
      boardId: record.boardId,
      name: record.name,
      appName: record.appName,
      status: record.status,
      turn: record.turn,
      attempt: record.attempt,
      ...record.caption === undefined ? {} : { caption: record.caption },
      ...record.baseXml === undefined ? {} : { baseXml: record.baseXml },
      ...record.currentXml === undefined ? {} : { currentXml: record.currentXml },
      ...record.originalXml === undefined ? {} : { originalXml: record.originalXml },
      commands: record.commands,
    }
  }

  /** Wait for a board's creation receipt. */
  waitReady(sessionId: string, boardId: string, timeoutMs: number): Promise<BoardRecord | undefined> {
    const record = this.#sessions.get(sessionId)?.get(boardId)
    if (record !== undefined && record.status !== 'creating') return Promise.resolve(record)
    const key = `${sessionId}:${boardId}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs)
      const list = this.#waiters.get(key) ?? []
      list.push((ready) => {
        clearTimeout(timer)
        resolve(ready)
      })
      this.#waiters.set(key, list)
    })
  }

  /** Apply the creation receipt: original = current = reported XML. */
  receipt(sessionId: string, boardId: string, input: {
    xml: string
    ggbBase64?: string
    sheet: SheetEntry[]
    failed: Array<{ command: string, error?: string }>
    warnings?: Array<{ command: string, note: string }>
  }): BoardRecord | undefined {
    const record = this.get(sessionId, boardId)
    if (record === undefined) return undefined
    const size = input.xml.length + (input.ggbBase64?.length ?? 0) * 2
    record.originalXml = input.xml
    record.currentXml = input.xml
    if (input.ggbBase64 !== undefined) {
      record.originalGgbBase64 = input.ggbBase64
      record.currentGgbBase64 = input.ggbBase64
    }
    record.sheet = input.sheet
    record.originalSheet = input.sheet
    record.failed = input.failed
    record.warnings = input.warnings ?? []
    record.status = 'draft'
    record.updatedAt = Date.now()
    if (size > MAX_BOARD_BYTES) record.failed = [...record.failed, { command: '(board too large)', error: 'board exceeds the size budget' }]
    this.#persist(record)
    const key = `${sessionId}:${boardId}`
    for (const resolve of this.#waiters.get(key) ?? []) resolve(record)
    this.#waiters.delete(key)
    return record
  }

  /** Apply a user edit: current changes, original stays. */
  update(sessionId: string, boardId: string, input: {
    xml: string
    ggbBase64?: string
    sheet: SheetEntry[]
  }): BoardRecord | undefined {
    const record = this.get(sessionId, boardId)
    if (record === undefined || record.status === 'creating') return undefined
    record.currentXml = input.xml
    if (input.ggbBase64 !== undefined) record.currentGgbBase64 = input.ggbBase64
    record.sheet = input.sheet
    record.updatedAt = Date.now()
    this.#persist(record)
    return record
  }

  /** Delete one board and its snapshot file. */
  delete(sessionId: string, reference: string): BoardRecord | undefined {
    const boards = this.#load(sessionId)
    const record = this.get(sessionId, reference)
    if (record === undefined) return undefined
    boards.delete(record.boardId)
    try {
      rmSync(this.#file(sessionId, record.boardId), { force: true })
    } catch {
      // The in-memory removal still applies.
    }
    return record
  }

  /** Rename a board; the id never changes. */
  rename(sessionId: string, reference: string, name: string): BoardRecord | undefined {
    const record = this.get(sessionId, reference)
    if (record === undefined) return undefined
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('the new name must not be empty')
    const boards = this.#load(sessionId)
    for (const other of boards.values()) {
      if (other.boardId !== record.boardId && other.name === trimmed) {
        throw new Error(`another board is already named "${trimmed}"`)
      }
    }
    record.name = trimmed
    record.updatedAt = Date.now()
    this.#persist(record)
    return record
  }
}
