/**
 * dsh-geogebra — browser half.
 *
 * One card per immutable board. The card fetches the board payload from the
 * Host, renders the construction once, executes the creation commands, reports
 * back (XML + sheet + `.ggb`), then reports user edits on a debounce.
 *
 * There is no polling, no command queue and no cross-surface sync: the Host is
 * the source of truth and every card is just a view.
 */
import * as React from 'react'

export const name = 'dsh-geogebra-client'

/** Client services this plugin needs before it may register anything. */
export const inject = ['slots', 'uiConversation', 'connection']

/** RPC caller captured at apply time. */
let rpc: {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
    ok: boolean
    value?: unknown
    error?: { message?: string }
  }>
} | undefined

/** One object as GeoGebra describes it. */
interface SheetEntry {
  label: string
  type: string
  definition: string
  text: string
  x?: number
  y?: number
  value?: string
}

/** Host payload for one card. */
interface BoardPayload {
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

/** Blank GeoGebra document: an empty construction, no sample objects. */
function boardHtml(showInput: boolean, perspective: string, appName: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; }
      body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fff; }
      #ggb { position: absolute; inset: 0; }
      #status { position: absolute; inset: 0; display: grid; place-items: center; color: #5b6b80; background: #fbfcfe; }
      #status[hidden] { display: none; }
      #error { color: #b3261e; max-width: 520px; text-align: center; }
      /* GeoGebra error dialogs are read programmatically and dismissed; never
         show them over the board. */
      .dialogComponent, .gwt-PopupPanelGlass { display: none !important; }
      /* Undo/redo belong to the algebra editing surface; hide them while the
         algebra pane is hidden. */
      body.hide-undo .undoRedoPanel { display: none !important; }
    </style>
  </head>
  <body>
    <div id="ggb"></div>
    <div id="status"><div id="error">正在加载 GeoGebra…</div></div>
    <script src="https://www.geogebra.org/scripts/deployggb.js"></script>
    <script>
      (function () {
        var status = document.getElementById('status');
        var error = document.getElementById('error');
        function fail(message) {
          status.hidden = false;
          error.textContent = 'GeoGebra 加载失败：' + message;
        }
        if (typeof GGBApplet !== 'function') {
          fail('deployggb.js 不可用（网络或镜像问题）');
          return;
        }
        var params = {
          appName: '${appName}',
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          showMenuBar: false,
          showToolBar: true,
          showAlgebraInput: ${showInput ? 'true' : 'false'},
          showKeyboardButton: false,
          showResetIcon: false,
          showFullscreenButton: false,
          perspective: '${perspective}',
          language: 'zh',
          borderColor: '#ffffff',
          appletOnLoad: function (api) {
            window.ggbAPI = api;
            status.hidden = true;
            // One-shot undo hook: after "还原", pressing GeoGebra's undo (button
            // or Ctrl+Z) restores the user's own version, because setXML does not
            // participate in GeoGebra's undo stack.
            window.__dshRestore = null;
            document.addEventListener('click', function (event) {
              var target = event.target && event.target.closest ? event.target.closest('.undoRedoPanel button.undo') : null;
              if (target === null || typeof window.__dshRestore !== 'string') return;
              event.preventDefault();
              event.stopPropagation();
              var xml = window.__dshRestore;
              window.__dshRestore = null;
              try { api.setXML(xml); } catch (e) { fail(String(e)); }
            }, true);
            document.addEventListener('keydown', function (event) {
              if (!(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== 'z') return;
              if (typeof window.__dshRestore !== 'string') return;
              event.preventDefault();
              event.stopPropagation();
              var xml = window.__dshRestore;
              window.__dshRestore = null;
              try { api.setXML(xml); } catch (e) { fail(String(e)); }
            }, true);
            try {
              api.setAxesVisible(true, true);
              // Suite keeps its algebra sidebar until the perspective is applied
              // at runtime; the host side calls this again after setXML.
              if ('${perspective}' === 'G') api.setPerspective('G');
              document.body.classList.toggle('hide-undo', '${perspective}' === 'G');
            } catch (e) { fail(String(e)); }
            // The card resizes the iframe element without a window resize event.
            if (typeof ResizeObserver === 'function') {
              new ResizeObserver(function () {
                if (!window.ggbAPI) return;
                try {
                  window.ggbAPI.setWidth(document.documentElement.clientWidth);
                  window.ggbAPI.setHeight(document.documentElement.clientHeight);
                } catch (e) { /* ignore */ }
              }).observe(document.getElementById('ggb'));
            }
          },
        };
        try {
          new GGBApplet(params, true).inject('ggb');
        } catch (e) {
          fail(String(e));
        }
        window.addEventListener('resize', function () {
          if (window.ggbAPI) {
            window.ggbAPI.setWidth(document.documentElement.clientWidth);
            window.ggbAPI.setHeight(document.documentElement.clientHeight);
          }
        });
      })();
    </script>
  </body>
</html>`
}

/** Round to two decimals without trailing zeros. */
function round2(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '?'
  return String(Math.round(value * 100) / 100)
}

/** Build the construction sheet from the live applet. */
function buildSheet(api: any): SheetEntry[] {
  const entries: SheetEntry[] = []
  let labels: string[] = []
  try {
    labels = api.getAllObjectNames() as string[]
  } catch {
    return entries
  }
  for (const label of labels) {
    try {
      const type = String(api.getObjectType(label) ?? '')
      const definition = String(api.getDefinitionString(label) ?? '')
      const value = String(api.getValueString(label) ?? '')
      if (type === 'point' && api.isIndependent(label) === true) {
        const x = Number(api.getXcoord(label))
        const y = Number(api.getYcoord(label))
        entries.push({
          label,
          type,
          definition,
          text: `${label}(${round2(x)},${round2(y)})`,
          x,
          y,
          value,
        })
        continue
      }
      const text = definition === '' ? `${label}=${value}` : `${label}=${definition}`
      entries.push({ label, type, definition, text, value })
    } catch {
      // Skip an object GeoGebra refuses to describe instead of failing the card.
    }
  }
  return entries
}

/**
 * Read and dismiss one GeoGebra error dialog. The board CSS hides
 * `.dialogComponent`, so this never flashes over the card, but the message text
 * still reaches the Agent through the receipt.
 */
async function readDialog(win: Window | null | undefined): Promise<string | undefined> {
  if (win === null || win === undefined) return undefined
  await new Promise(resolve => setTimeout(resolve, 180))
  try {
    const nodes = [...win.document.querySelectorAll('.dialogComponent')]
    if (nodes.length === 0) return undefined
    const raw = nodes.map(node => (node.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' ')
    for (const node of nodes) {
      const buttons = [...node.querySelectorAll('button')]
      const button = buttons.find(item => /确定|关闭|OK|Close/i.test(item.textContent ?? '')) ?? buttons[buttons.length - 1]
      if (button !== undefined) (button as HTMLElement).click()
      else node.remove()
    }
    return raw
      .replace(/^(Error|错误)\s*/i, '')
      .replace(/\s*(确定|关闭|在线帮助|OK|Close)\s*$/gi, '')
      .trim()
  } catch {
    return undefined
  }
}

/**
 * One board card: render the board, run the creation commands once, report the
 * result, then report user edits on a debounce.
 * @param props - conversation node data and session scope.
 */
function BoardCard({ node, sessionId }: {
  node: { data?: Record<string, unknown> }
  sessionId?: string
}): React.JSX.Element {
  const boardId = typeof node.data?.boardId === 'string' ? node.data.boardId : ''
  const name = typeof node.data?.name === 'string' ? node.data.name : boardId
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const apiRef = React.useRef<any>(null)
  const startedRef = React.useRef(false)
  const debounceRef = React.useRef<number | undefined>(undefined)
  const watchRef = React.useRef<number | undefined>(undefined)
  const lastXmlRef = React.useRef<string>('')
  const [payload, setPayload] = React.useState<BoardPayload | null>(null)
  const [error, setError] = React.useState('')
  const [showAlgebra, setShowAlgebra] = React.useState(false)
  const [status, setStatus] = React.useState('正在准备画板…')
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [boardHeight, setBoardHeight] = React.useState(440)
  const [collapsed, setCollapsed] = React.useState(false)
  const [boardReady, setBoardReady] = React.useState(false)
  const [resizing, setResizing] = React.useState(false)
  const [deleted, setDeleted] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    if (typeof sessionId !== 'string' || boardId === '' || rpc === undefined) return
    let cancelled = false
    const call = rpc
    void call.call('/api', 'geogebra/board/get', { sessionId, boardId }).then((response) => {
      if (cancelled) return
      if (!response.ok) {
        const message = response.error?.message ?? '画板不存在'
        if (/not found/i.test(message)) setDeleted(true)
        else setError(message)
        return
      }
      setPayload(response.value as BoardPayload)
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { cancelled = true }
  }, [sessionId, boardId])

  React.useEffect(() => {
    if (payload === null || rpc === undefined) return
    startedRef.current = false
    setLoadFailed(false)
    setBoardReady(false)
    const call = rpc
    const current = payload
    // A blank white card usually means the applet never finished loading.
    // Surface that state instead of leaving the user guessing.
    const loadTimer = window.setTimeout(() => {
      if (!startedRef.current) setLoadFailed(true)
    }, 25_000)
    const timer = window.setInterval(() => {
      const api = (iframeRef.current?.contentWindow as (Window & { ggbAPI?: any }) | undefined)?.ggbAPI
      if (api === undefined) return
      window.clearInterval(timer)
      window.clearTimeout(loadTimer)
      startedRef.current = true
      apiRef.current = api
      void (async () => {
        try {
          if (current.status !== 'creating') {
            // Draft/final boards already have their construction: render it.
            if (current.currentXml !== undefined) api.setXML(current.currentXml)
          } else {
            // First run, or a same-turn amend: build from the base and rerun.
            if (current.baseXml !== undefined) api.setXML(current.baseXml)
            const failed: Array<{ command: string, error?: string }> = []
            const warnings: Array<{ command: string, note: string }> = []
            for (const line of current.commands) {
              let accepted: unknown = true
              try {
                accepted = api.evalCommand(line)
              } catch (failure) {
                accepted = false
                failed.push({ command: line, error: failure instanceof Error ? failure.message : String(failure) })
                continue
              }
              if (accepted === false) {
                const dialog = await readDialog(iframeRef.current?.contentWindow)
                if (dialog === undefined || dialog === '') {
                  // Style commands return false but still apply; only a real
                  // error dialog means the command was rejected.
                  warnings.push({ command: line, note: 'GeoGebra returned false without an error' })
                } else {
                  failed.push({ command: line, error: dialog })
                }
              }
            }
            await new Promise(resolve => setTimeout(resolve, 250))
            await call.call('/api', 'geogebra/board/receipt', {
              sessionId,
              boardId,
              xml: api.getXML(),
              ggbBase64: api.getBase64(),
              sheet: buildSheet(api),
              failed,
              warnings,
            })
          }
          // setXML may restore the saved perspective; keep the compact card
          // graph-only with the algebra chrome (undo/redo) hidden.
          try {
            api.setPerspective('G')
            iframeRef.current?.contentWindow?.document.body.classList.add('hide-undo')
          } catch {
            // Ignore: the applet may not support the call in every mode.
          }
          setBoardReady(true)
          // GeoGebra's JS listeners do not fire for programmatic changes, so
          // watch the serialized construction locally (cheap: one getXML/s) and
          // report only when it actually changed.
          lastXmlRef.current = api.getXML()
          const scheduleUpdate = (): void => {
            if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
            debounceRef.current = window.setTimeout(() => {
              if (rpc === undefined) return
              void rpc.call('/api', 'geogebra/board/update', {
                sessionId,
                boardId,
                xml: api.getXML(),
                ggbBase64: api.getBase64(),
                sheet: buildSheet(api),
              }).catch(() => undefined)
            }, 500)
          }
          watchRef.current = window.setInterval(() => {
            const xml = api.getXML()
            if (xml === lastXmlRef.current) return
            lastXmlRef.current = xml
            scheduleUpdate()
          }, 1000)
          setStatus('')
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })()
    }, 100)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(loadTimer)
      if (watchRef.current !== undefined) window.clearInterval(watchRef.current)
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    }
  }, [payload === null ? -1 : payload.attempt, sessionId, boardId, reloadKey])

  // Draft boards may be amended in the same turn; the Host bumps `attempt` and
  // the card remounts the iframe to rerun the construction.
  React.useEffect(() => {
    if (payload === null || payload.status === 'final' || rpc === undefined) return
    const call = rpc
    const attempt = payload.attempt
    const status = payload.status
    const timer = window.setInterval(() => {
      void call.call('/api', 'geogebra/board/get', { sessionId, boardId }).then((response) => {
        if (!response.ok) return
        const next = response.value as BoardPayload
        if (next.attempt !== attempt || next.status !== status) setPayload(next)
      }).catch(() => undefined)
    }, 1200)
    return () => window.clearInterval(timer)
  }, [payload, sessionId, boardId])

  const buttonStyle = {
    cursor: 'pointer',
    background: '#fff',
    color: 'inherit',
    border: '1px solid var(--dsh-border, #d9e2ef)',
    borderRadius: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    lineHeight: '18px',
    whiteSpace: 'nowrap' as const,
  }

  const toggleAlgebra = (): void => {
    const next = !showAlgebra
    setShowAlgebra(next)
    try {
      apiRef.current?.setPerspective(next ? 'AG' : 'G')
      const doc = iframeRef.current?.contentWindow?.document
      doc?.body.classList.toggle('hide-undo', !next)
    } catch {
      // The applet may not be ready yet.
    }
  }

  const resetToOriginal = (): void => {
    if (payload?.originalXml === undefined) return
    try {
      const api = apiRef.current
      const current = api?.getXML()
      const win = iframeRef.current?.contentWindow as (Window & { __dshRestore?: string | null }) | undefined
      // Keep the user's version so one undo returns to it (setXML itself is
      // not undoable inside GeoGebra).
      if (win !== undefined && typeof current === 'string') win.__dshRestore = current
      api?.setXML(payload.originalXml)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const deleteBoard = (): void => {
    if (rpc === undefined || typeof sessionId !== 'string') return
    void rpc.call('/api', 'geogebra/board/delete', { sessionId, boardId }).then((response) => {
      if (response.ok) setDeleted(true)
    }).catch(() => undefined)
  }

  const requestDelete = (): void => {
    if (confirmDelete) {
      setConfirmDelete(false)
      deleteBoard()
      return
    }
    setConfirmDelete(true)
    window.setTimeout(() => setConfirmDelete(false), 4000)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = boardHeight
    setResizing(true)
    const onMove = (move: PointerEvent): void => {
      setBoardHeight(Math.max(180, Math.min(900, startHeight + (move.clientY - startY))))
    }
    const onUp = (): void => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const linkButtonStyle = {
    background: 'transparent',
    border: 'none',
    color: '#4b5563',
    fontSize: '12px',
    lineHeight: '18px',
    padding: '2px 6px',
    cursor: 'pointer',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
  }
  const divider = (key: string): React.JSX.Element => React.createElement('span', {
    key,
    style: { width: '1px', height: '12px', background: '#e5e7eb', margin: '0 2px' },
  })

  if (deleted) {
    return React.createElement('div', {
      style: {
        border: '1px solid var(--dsh-border, #e5e7eb)',
        borderRadius: '10px',
        margin: '8px 0',
        background: 'var(--dsh-surface, #fff)',
        overflow: 'hidden',
      },
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        background: '#f7f8fa',
        color: '#9ca3af',
        fontSize: '12px',
      },
    }, [
      React.createElement('span', { key: 'title' }, `${name} - ${boardId}`),
      React.createElement('span', { key: 'state' }, '已被删除'),
    ]))
  }

  return React.createElement('div', {
    style: {
      border: '1px solid var(--dsh-border, #e5e7eb)',
      borderRadius: '10px',
      margin: '8px 0',
      background: 'var(--dsh-surface, #fff)',
      overflow: 'hidden',
    },
  }, [
    React.createElement('div', {
      key: 'head',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        background: '#f7f8fa',
        borderBottom: '1px solid #e8ebf0',
      },
    }, [
      React.createElement('span', {
        key: 'title',
        title: `${payload?.name ?? name} - ${boardId}`,
        style: {
          fontSize: '12px',
          fontWeight: 400,
          color: '#374151',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        },
      }, `${payload?.name ?? name} - ${boardId}`),
      status === '' ? null : React.createElement('span', {
        key: 'status',
        style: { color: '#9ca3af', fontSize: '12px', whiteSpace: 'nowrap' },
      }, status),
      React.createElement('div', {
        key: 'actions',
        style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' },
      }, [
        React.createElement('button', {
          key: 'algebra',
          type: 'button',
          onClick: toggleAlgebra,
          style: linkButtonStyle,
        }, showAlgebra ? '隐藏代数区' : '显示代数区'),
        divider('d1'),
        React.createElement('button', {
          key: 'reset',
          type: 'button',
          onClick: resetToOriginal,
          style: linkButtonStyle,
        }, '还原'),
        divider('d2'),
        React.createElement('button', {
          key: 'collapse',
          type: 'button',
          'aria-label': collapsed ? '展开画板' : '折叠画板',
          onClick: () => setCollapsed(value => !value),
          style: linkButtonStyle,
        }, collapsed ? '展开' : '折叠'),
        divider('d3'),
        React.createElement('button', {
          key: 'delete',
          type: 'button',
          onClick: requestDelete,
          style: { ...linkButtonStyle, color: '#b3261e', minWidth: '4.5em', textAlign: 'center' },
        }, confirmDelete ? '确认删除' : '删除'),
      ]),
    ]),
    payload?.caption === undefined ? null : React.createElement('div', {
      key: 'caption',
      title: payload.caption,
      style: {
        padding: '6px 10px 0',
        fontSize: '12px',
        color: '#6b7280',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
    }, payload.caption),
    React.createElement('div', {
      key: 'board',
      style: {
        display: 'grid',
        gridTemplateRows: collapsed ? '0fr' : '1fr',
        transition: 'grid-template-rows 200ms ease',
      },
    }, React.createElement('div', {
      key: 'clip',
      style: { overflow: 'hidden' },
    }, React.createElement('div', {
      key: 'inner',
      style: { display: 'grid', gap: '2px', padding: '6px 10px 8px' },
    }, [
      React.createElement('div', {
        key: 'frame',
        style: { position: 'relative', height: boardHeight, minHeight: '180px' },
      }, [
        payload === null
          ? React.createElement('div', {
            key: 'loading',
            style: { height: '100%', display: 'grid', placeItems: 'center', color: '#6b7c93' },
          }, '正在准备画板…')
          : React.createElement('iframe', {
            key: `${boardId}:${payload.attempt}:${reloadKey}`,
            ref: iframeRef,
            title: `GeoGebra ${boardId}`,
            srcDoc: boardHtml(false, 'G', payload.appName),
            style: {
              width: '100%',
              height: '100%',
              border: '0',
              display: 'block',
              background: '#fff',
              pointerEvents: resizing ? 'none' : 'auto',
            },
          }),
        payload !== null && !boardReady
          ? React.createElement('div', {
            key: 'drawing',
            style: {
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(255, 255, 255, 0.85)',
              color: '#6b7c93',
              fontSize: '12px',
              zIndex: 1,
            },
          }, '正在绘制…')
          : null,
      ]),
      React.createElement('div', {
        key: 'resize',
        onPointerDown: startResize,
        title: '拖动调整高度',
        style: { height: '8px', cursor: 'ns-resize', display: 'grid', placeItems: 'center' },
      }, React.createElement('div', {
        key: 'grip',
        style: { width: '36px', height: '2px', borderRadius: '1px', background: 'var(--dsh-border, #d9e2ef)' },
      })),
    ]))),
    loadFailed
      ? React.createElement('div', {
        key: 'load-failed',
        style: { display: 'flex', alignItems: 'center', gap: '8px', color: '#b3261e', fontSize: '12px', padding: '0 10px 8px' },
      }, [
        React.createElement('span', { key: 't' }, 'GeoGebra 加载超时（可能网络慢）。'),
        React.createElement('button', {
          key: 'retry',
          type: 'button',
          onClick: () => { setLoadFailed(false); setReloadKey(value => value + 1) },
          style: linkButtonStyle,
        }, '重试'),
      ])
      : null,
    error === '' ? null : React.createElement('div', {
      key: 'error',
      style: { color: '#b3261e', fontSize: '12px', padding: '0 10px 8px' },
    }, error),
  ])
}

/** Conversation node definition for one board card. */
const boardNodeDefinition = {
  kind: 'geogebra-board',
  target: 'chat',
  match: (event: { type: string, seq: number, data?: Record<string, unknown> }) => {
    if (event.type !== 'plugin:dsh-geogebra/board') return null
    const boardId = event.data?.boardId
    return { id: typeof boardId === 'string' ? boardId : String(event.seq), role: 'start' }
  },
  start: (_context: unknown, match: { event: { data?: Record<string, unknown> } }) => ({ ...match.event.data }),
  update: (context: { state?: Record<string, unknown> }) => context.state,
  buildViewNode: (context: {
    key: string
    id: string
    state?: Record<string, unknown>
    start?: { event: { seq: number }, location?: unknown }
    matches: readonly { event: { seq: number } }[]
  }) => {
    const state = context.state
    if (state === undefined) return null
    const seq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0
    return {
      key: context.key,
      kind: 'geogebra-board',
      id: context.id,
      target: 'chat' as const,
      anchorSeq: seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible' as const,
      groupTree: 'turn' as const,
      data: state,
    }
  },
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: {
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: { name: string, key: string }, component: unknown): unknown
  }
  uiConversation: { events: { register(definition: unknown): unknown } }
  connection: { rpc: typeof rpc }
}): void {
  rpc = ctx.connection?.rpc
  ctx.uiConversation.events.register(boardNodeDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'geogebra-board' },
    BoardCard,
  ))
}
