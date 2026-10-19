/**
 * dsh-geogebra — host half.
 *
 * Immutable snapshot boards: the Agent creates a board, the browser renders and
 * executes it once, the Host stores XML + sheet + `.ggb`. The Agent never
 * mutates an existing board; continuing means creating a new one from it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { BoardStore, diffText, fmt, sheetText } from './boards.ts'
import type { BoardRecord } from './boards.ts'
import { findWhiteColors, lintCommands } from './command-lint.ts'

/** Cordis plugin name. */
export const name = 'dsh-geogebra'

/** Services required before `apply`. */
export const inject = ['tools', 'sessionProjections', 'connection', 'systemPrompt']

/** Durable plugin-record type carrying one board card. */
const BOARD_RECORD = 'plugin:dsh-geogebra/board'

/** Where the GeoGebra workflow guidance sits in the system prompt. */
const PROMPT_ORDER = 3200

/** Model-facing workflow guidance (the tool schemas cannot say this). */
const PROMPT_TEXT = `## GeoGebra 画板

用 geogebra_create 作图，必须起一个短名字（4–12 字，会话内唯一）。

**用户要什么就画什么。** 一条命令能完成就别拆成多条；不要自行添加滑块、辅助点、标注、交点、缩放或视图调整，除非用户明确要求。**不要改颜色、线宽、点大小**；尤其不要把任何对象设成白色或浅色——白底上会完全看不见。默认样式就很好。

旧板不可修改：想接着画，先 geogebra_check 看用户改了什么，再用 geogebra_create 的 from 基于它生成新板。命令失败时用 geogebra_amend 在同一个回合修正（只需重发失败的那几条，已有对象会保留；发完整列表也可以）；回合结束后板会冻结。

默认用 suite（新版界面，指令最全）。只有用户明确要"函数图形计算器"、且内容只是函数曲线时才用 graphing；evaluator、scientific、notes 按需。

一次 create 成功后就向用户汇报画了什么，不要再调用 inspect、list 或 check，除非需要具体数值、找旧板、或准备基于旧板继续。**调用 create 时用 caption 参数写一句你要画什么**（会显示在卡片标题下；写不出具体内容就写一句概览），画完再简短补充结果。`

interface SessionLike {
  readonly id: string
}

interface ExecLike {
  readonly callId: string
  readonly agent?: { readonly session: SessionLike }
}

/** Split a command blob into non-empty lines. */
function commandLines(commands: unknown): string[] {
  if (typeof commands !== 'string') return []
  return commands.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/** Host home directory. */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Register the six board tools and the card's transport routes.
 * @param ctx - host context.
 */
export function apply(ctx: {
  tools: { register(definition: unknown): () => void }
  sessionProjections: { stateOf(session: unknown, key: string): { lastTurn?: number } | undefined }
  connection: {
    fetch: { register(route: {
      path: string
      methods: readonly string[]
      requestBody: 'buffered' | 'streaming'
      fetch(request: Request): Promise<Response>
    }): () => Promise<void> }
  }
  systemPrompt: { section(definition: { name: string, order: number, text: string }): unknown }
  effect(fn: () => () => void, label?: string): void
}): void {
  const store = new BoardStore(dshHome())
  ctx.systemPrompt.section({ name: 'dsh-geogebra:workflow', order: PROMPT_ORDER, text: PROMPT_TEXT })

  const registerRoute = (endpoint: string, handler: (payload: Record<string, unknown>) => unknown): void => {
    ctx.effect(() => {
      let dispose: (() => Promise<void>) | undefined
      void ctx.connection.fetch.register({
        path: `/api/geogebra/board/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request: Request): Promise<Response> {
          let envelope: { rpcId?: unknown, method?: unknown, payload?: unknown }
          try {
            envelope = await request.json()
          } catch {
            return new Response('body is not JSON', { status: 400 })
          }
          const rpcId = envelope.rpcId
          if (typeof rpcId !== 'string' || envelope.method !== `geogebra/board/${endpoint}`) {
            return new Response('invalid Connection RPC envelope', { status: 400 })
          }
          try {
            const value = await handler((envelope.payload ?? {}) as Record<string, unknown>)
            return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return Response.json({
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'GEOGEBRA', message, details: {} } },
            })
          }
        },
      }).then(value => { dispose = value })
      return () => { void dispose?.() }
    }, `dsh-geogebra: route ${endpoint}`)
  }

  registerRoute('get', (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const boardId = String(payload.boardId ?? '')
    const record = store.get(sessionId, boardId)
    if (record === undefined) throw new Error(`board "${boardId}" not found`)
    return store.payload(record)
  })

  registerRoute('receipt', (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const boardId = String(payload.boardId ?? '')
    if (typeof payload.xml !== 'string') throw new Error('receipt requires xml')
    const record = store.receipt(sessionId, boardId, {
      xml: payload.xml,
      ggbBase64: typeof payload.ggbBase64 === 'string' ? payload.ggbBase64 : undefined,
      sheet: Array.isArray(payload.sheet) ? payload.sheet as never : [],
      failed: Array.isArray(payload.failed) ? payload.failed as never : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings as never : [],
    })
    if (record === undefined) throw new Error(`board "${boardId}" not found`)
    return { boardId, status: record.status }
  })

  registerRoute('update', (payload) => {
    const sessionId = String(payload.sessionId ?? '')
    const boardId = String(payload.boardId ?? '')
    if (typeof payload.xml !== 'string') throw new Error('update requires xml')
    const record = store.update(sessionId, boardId, {
      xml: payload.xml,
      ggbBase64: typeof payload.ggbBase64 === 'string' ? payload.ggbBase64 : undefined,
      sheet: Array.isArray(payload.sheet) ? payload.sheet as never : [],
    })
    if (record === undefined) throw new Error('board is not ready')
    return { boardId, updatedAt: record.updatedAt }
  })

  const resolve = (sessionId: string, reference: unknown): BoardRecord => {
    const record = store.get(sessionId, String(reference ?? ''))
    if (record === undefined) {
      const names = store.list(sessionId).map(item => `${item.boardId}「${item.name}」`).join('、')
      throw new Error(`board "${String(reference ?? '')}" not found. Known boards: ${names || '(none)'}`)
    }
    return record
  }

  const currentTurn = (session: SessionLike): number =>
    ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0

  const failureLines = (failed: BoardRecord['failed']): string[] => {
    if (failed.length === 0) return []
    const lines = [`${failed.length} 条命令失败：`]
    for (const failure of failed) {
      lines.push(`  ${failure.command}${failure.error === undefined ? '' : ` — ${failure.error}`}`)
    }
    return lines
  }

  const warningLines = (warnings: BoardRecord['warnings']): string[] => {
    if (warnings.length === 0) return []
    const lines = [`注意：${warnings.length} 条命令返回 false 但没有报错，可能已生效（不要重发）：`]
    for (const warning of warnings) lines.push(`  ${warning.command}`)
    return lines
  }

  /** Reject likely command-name typos before a board is created or amended. */
  const lintOrThrow = (commands: readonly string[]): void => {
    const white = findWhiteColors(commands)
    if (white.length > 0) {
      throw new Error(
        '检测到白色/近白色对象（白底上看不见），已拒绝执行（不会创建/修改画板）：\n  '
        + white.join('\n  ')
        + '\n请用默认颜色或深色；除非用户明确要求，不要改颜色。',
      )
    }
    const issues = lintCommands(commands)
    if (issues.length === 0) return
    const lines = ['指令名可能有误，已拒绝执行（不会创建/修改画板）：']
    for (const issue of issues) {
      const docs = issue.suggestion === undefined
        ? ''
        : `（文档：https://geogebra.github.io/docs/manual/en/commands/${issue.suggestion}/）`
      lines.push(`  ${issue.unknown} → 最接近 ${issue.suggestion}${docs}`)
    }
    throw new Error(lines.join('\n'))
  }

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_create',
    description: 'Create a new immutable GeoGebra board and return its full construction sheet. '
      + 'Before calling this tool, write one short sentence saying what you are about to draw. '
      + 'Pass `from` to start from an existing board; the Agent never modifies an existing board. '
      + 'Always give the board a short name. Keep the construction minimal: draw only what the user asked for, '
      + 'with default styling, no extra sliders, labels, intersections, colors or zooming unless requested. '
      + 'If commands fail, fix them with geogebra_amend in the same turn instead of creating another board.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Short board name (4-12 chars), unique in this session.' },
        caption: { type: 'string', description: 'One sentence describing what you are about to draw; shown on the card. Write it before drawing.' },
        commands: { type: 'string', description: 'GeoGebra input-bar commands, one per line, executed in order.' },
        from: { type: 'string', description: 'Existing board id or name to use as the base construction.' },
        as: { type: 'string', enum: ['current', 'original'], description: 'Which version of `from` to use (default current).' },
        appName: { type: 'string', description: 'Default suite (modern UI, all commands). classic, graphing, geometry, 3d, evaluator, scientific, notes.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: {
      name?: string
      caption?: string
      commands?: string
      from?: string
      as?: string
      appName?: string
    }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_create requires an agent session')
      const turn = currentTurn(session)
      store.finalizeBefore(session.id, turn)
      const requestedName = String(args.name ?? '').trim()
      if (requestedName === '') throw new Error('geogebra_create requires a short board name')
      let from: BoardRecord | undefined
      let baseXml: string | undefined
      if (args.from !== undefined && args.from !== '') {
        from = resolve(session.id, args.from)
        if (from.status === 'creating') throw new Error(`${from.boardId} 尚未回填，暂不能作为底稿。等回执完成后再试。`)
        const useOriginal = args.as === 'original'
        baseXml = useOriginal ? from.originalXml : from.currentXml
        if (baseXml === undefined) throw new Error(`${from.boardId} has no saved XML to use as a base`)
      }
      const record = store.create({
        sessionId: session.id,
        name: requestedName,
        appName: typeof args.appName === 'string' ? args.appName : 'suite',
        caption: typeof args.caption === 'string' ? args.caption : undefined,
        baseXml,
        commands: (() => {
          const commands = commandLines(args.commands)
          lintOrThrow(commands)
          return commands
        })(),
        turn,
      })
      appendPluginRecord(session as never, BOARD_RECORD as never, {
        boardId: record.boardId,
        name: record.name,
        turn,
        at: Date.now(),
      } as never)
      const ready = await store.waitReady(session.id, record.boardId, 8000)
      if (ready === undefined) {
        return `${record.boardId}「${record.name}」已创建（状态待回填）。回执到达后会自动补全；补全前 inspect/check 会提示"尚未回填"。`
      }
      const parts: string[] = []
      const changed = from === undefined ? '' : diffText(from.originalSheet, from.sheet)
      const base = from === undefined ? '' : `，基于 ${from.boardId}「${from.name}」${changed === '' ? '' : `（用户改过：${changed}）`}`
      parts.push(`${record.boardId}「${record.name}」已创建${base}：`)
      parts.push(sheetText(ready.sheet))
      const added = diffText(from?.sheet, ready.sheet)
      if (added !== '') parts.push(`本次新增：${added}`)
      if (ready.failed.length > 0) {
        parts.push(...failureLines(ready.failed))
        parts.push('（修正请用 geogebra_amend，不要为同样的内容再新建板。）')
      }
      if (ready.warnings.length > 0) parts.push(...warningLines(ready.warnings))
      return parts.join('\n')
    },
  }), 'dsh-geogebra: create')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_amend',
    description: 'Fix a board created in the current turn: run new commands on top of its current construction. '
      + 'Resend only the failed commands (existing objects are kept); sending the full list also works because GeoGebra redefines labels. '
      + 'Only the current turn may amend; after the turn the board is frozen.',
    parameters: {
      type: 'object',
      required: ['board'],
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        commands: { type: 'string', description: 'Replacement command list, one per line.' },
        caption: { type: 'string', description: 'Optional updated one-line description shown on the card.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string, commands?: string, caption?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_amend requires an agent session')
      const turn = currentTurn(session)
      store.finalizeBefore(session.id, turn)
      const record = resolve(session.id, args.board)
      const commands = commandLines(args.commands)
      lintOrThrow(commands)
      store.amend(session.id, record.boardId, commands, turn, typeof args.caption === 'string' ? args.caption : undefined)
      const ready = await store.waitReady(session.id, record.boardId, 8000)
      if (ready === undefined) return `${record.boardId} 已重新提交（状态待回填）。`
      const parts = [`${record.boardId}「${record.name}」已重新生成：`, sheetText(ready.sheet)]
      if (ready.failed.length > 0) parts.push(...failureLines(ready.failed))
      return parts.join('\n')
    },
  }), 'dsh-geogebra: amend')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_commit',
    description: 'Freeze a board immediately. Boards are frozen automatically when the turn ends, so this is only needed to freeze early.',
    parameters: {
      type: 'object',
      required: ['board'],
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_commit requires an agent session')
      const record = resolve(session.id, args.board)
      store.commit(session.id, record.boardId)
      return `${record.boardId}「${record.name}」已定稿。`
    },
  }), 'dsh-geogebra: commit')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_check',
    description: 'Report whether an existing board was edited by the user since the Agent created it, and what changed. '
      + 'Call this before creating a board from an old one.',
    parameters: {
      type: 'object',
      required: ['board'],
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_check requires an agent session')
      store.finalizeBefore(session.id, currentTurn(session))
      const record = resolve(session.id, args.board)
      if (record.status === 'creating') return `${record.boardId} 尚未回填（画板还没加载完成）。稍后再试，或用 geogebra_list 查看状态。`
      const changed = diffText(record.originalSheet, record.sheet)
      if (changed === '') return `${record.boardId}「${record.name}」未被修改。`
      return `${record.boardId}「${record.name}」被修改：${changed}。\n当前清单：${sheetText(record.sheet)}`
    },
  }), 'dsh-geogebra: check')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_inspect',
    description: 'Read the construction sheet of a board, or one object\'s definition and value.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        name: { type: 'string', description: 'Object label; omit to read the whole sheet.' },
        detail: { type: 'string', enum: ['definition', 'value'], description: 'What to report for one object.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string, name?: string, detail?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_inspect requires an agent session')
      store.finalizeBefore(session.id, currentTurn(session))
      const record = resolve(session.id, args.board)
      if (record.status === 'creating') return `${record.boardId} 尚未回填（画板还没加载完成）。稍后再试，或用 geogebra_list 查看状态。`
      const sheet = record.sheet ?? []
      const label = typeof args.name === 'string' ? args.name : ''
      if (label === '') return `${record.boardId}「${record.name}」清单：\n${sheetText(sheet)}`
      const entry = sheet.find(item => item.label === label)
      if (entry === undefined) throw new Error(`object "${label}" not found. Objects: ${sheet.map(item => item.label).join(', ')}`)
      if (entry.x !== undefined) {
        return `${label}：点 (${fmt(entry.x)}, ${fmt(entry.y)})${args.detail === 'value' && entry.value !== undefined ? ` · ${entry.value}` : ''}`
      }
      const value = args.detail === 'value' && entry.value !== undefined ? ` · ${entry.value}` : ''
      return `${label}：${entry.definition}${value}`
    },
  }), 'dsh-geogebra: inspect')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_rename',
    description: 'Rename a board. The board id never changes.',
    parameters: {
      type: 'object',
      required: ['board', 'name'],
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        name: { type: 'string', description: 'New short name.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string, name?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_rename requires an agent session')
      const record = resolve(session.id, args.board)
      const renamed = store.rename(session.id, record.boardId, String(args.name ?? ''))
      return `${record.boardId} 已改名为「${renamed?.name ?? ''}」。`
    },
  }), 'dsh-geogebra: rename')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_list',
    description: 'List every board in this session with its id, name, object count and edit state.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args: unknown, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_list requires an agent session')
      store.finalizeBefore(session.id, currentTurn(session))
      const boards = store.list(session.id)
      if (boards.length === 0) return '这次会话还没有画板。'
      return boards.map((record) => {
        if (record.status === 'creating') return `${record.boardId}「${record.name}」待回填`
        const changed = diffText(record.originalSheet, record.sheet)
        const state = changed === '' ? '未改动' : '用户改过'
        return `${record.boardId}「${record.name}」${record.sheet?.length ?? 0} 个对象 · ${state}${record.status === 'draft' ? ' · 本轮可改' : ''}`
      }).join('\n')
    },
  }), 'dsh-geogebra: list')

  ctx.effect(() => ctx.tools.register({
    name: 'geogebra_export',
    description: 'Export a board as .ggb (current version by default). PNG/SVG/PDF require the board to be visible and are not implemented yet.',
    parameters: {
      type: 'object',
      required: ['board', 'format'],
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        format: { type: 'string', enum: ['ggb', 'png', 'svg', 'pdf'] },
        as: { type: 'string', enum: ['current', 'original'], description: 'Which version to export (default current).' },
        path: { type: 'string', description: 'Optional workspace path; omitted writes under the Harness home.' },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { board?: string, format?: string, as?: string, path?: string }, exec: ExecLike) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('geogebra_export requires an agent session')
      store.finalizeBefore(session.id, currentTurn(session))
      const record = resolve(session.id, args.board)
      if (record.status === 'creating') throw new Error(`${record.boardId} 的 XML 尚未生成，无法导出。`)
      const format = String(args.format ?? 'ggb')
      if (format !== 'ggb') {
        throw new Error(`${format} export needs the board to be rendered; it is not implemented yet. Use .ggb for now.`)
      }
      const base64 = args.as === 'original' ? record.originalGgbBase64 : record.currentGgbBase64
      if (base64 === undefined) throw new Error(`${record.boardId} has no .ggb snapshot yet`)
      const target = typeof args.path === 'string' && args.path.trim() !== ''
        ? args.path
        : join(dshHome(), 'geogebra', 'exports', `${record.boardId}-${record.name}-${Date.now()}.ggb`)
      const absolute = target.startsWith('/') || /^[A-Za-z]:/.test(target) ? target : join(process.cwd(), target)
      mkdirSync(join(absolute, '..'), { recursive: true })
      writeFileSync(absolute, Buffer.from(base64, 'base64'))
      return `已导出 ${record.boardId}「${record.name}」到 ${absolute}`
    },
  }), 'dsh-geogebra: export')
}
