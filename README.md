# DSH GeoGebra Chat

**Draw GeoGebra directly inside DeepSeek Harness conversations.** Every drawing creates an independent, immutable snapshot board; explanations, edits and follow-up constructions all happen in the chat.

[DeepSeek Harness](https://github.com/deepseek-ai) · GeoGebra 6 · MIT

![Board card](assets/card.png)

> **Status: experimental 0.1.0.** Tested on DSH `0.2.1-rc.2`. DSH plugin APIs are still evolving, so upgrades may require adjustments.

> **AI-written code.** The current version was written entirely by AI (DeepSeek). Human review is planned. Treat it as experimental and review it yourself before production use.

中文说明：[docs/README.zh-CN.md](docs/README.zh-CN.md)

---

## Why this exists

A typical "AI draws a picture" flow produces either a static image or a single shared canvas that gets overwritten. When teaching math, that causes two problems:

1. **History gets overwritten** — draw case one, then case two, and case one is gone.
2. **The AI forgets what it drew** — as the context grows, object names and dependencies start to drift.

This plugin turns boards into **immutable snapshots**:

- Every `create` is a new board; older boards are never modified.
- To continue from an old board, the new board is seeded from its XML instead of editing it in place.
- The host stores the full XML, `.ggb` and construction sheet; the Agent always reads the authoritative sheet from a tool instead of relying on memory.
- If a construction is wrong, `amend` can fix it within the same turn without leaving a broken board behind.

## Quick start

Install the package into your DSH environment, then register it in the profile patch:

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '@normal-git/dsh-geogebra-chat'
```

When developing from source, point at `src/index.ts` (absolute path required):

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '<path-to-plugin>/src/index.ts'
```

Start DSH:

```bash
dsh --profile <name> --patch <path-to-patch>.yml web --port 3099 --no-open
```

No GeoGebra configuration is needed: it is loaded from the CDN by default.

## Usage

Just talk to the Agent:

> Draw a square with side length 2, then draw its circumscribed circle.

The Agent calls `geogebra_create` and a card appears in the conversation. On the card you can:

| Action | Description |
|---|---|
| Fold / expand | The folded state is remembered per session and board |
| Drag the bottom edge | Resize the board |
| Show algebra | Open GeoGebra's algebra pane |
| Restore | Return to the Agent's original version; one undo brings back your edits |
| Delete | Two-step confirmation, then a collapsed "deleted" tombstone |
| Wheel | Hover and scroll to zoom the board |

To continue:

> Draw a diagonal inside this square.

The Agent first calls `geogebra_check` to see the current state, then creates a new board seeded from the old one.

## Tools

| Tool | Purpose |
|---|---|
| `geogebra_create` | Create a board (name required; optional `from` an old board) |
| `geogebra_amend` | Resend/fix commands within the same turn, keeping existing objects |
| `geogebra_commit` | Freeze a draft early |
| `geogebra_check` | What the user changed, plus the current sheet |
| `geogebra_inspect` | Definition/value of one object |
| `geogebra_rename` | Rename a board (id unchanged) |
| `geogebra_list` | List all boards in this session |
| `geogebra_export` | Export `.ggb` (current or Agent-original version) |
| `geogebra_delete` | Delete a board (only when the user explicitly asks) |

Tools return GeoGebra's own **construction sheet** (objects, types, definitions, text), not XML/base64/images, to keep the model context small.

## How it works

```
Agent ── geogebra_create ──▶ Host board store (XML / .ggb / sheet)
                                    │
                                    ▼
                       Conversation node: one board card
                                    │
                            GeoGebra inside an iframe
```

- **The host is the source of truth**: board records are JSON files under `<DSH_HOME>/geogebra/boards/<session>/`.
- **The card is only a renderer**: unmounting the card, reloading the page or restarting DSH does not lose boards.
- **Each board has three states**: `creating` (waiting for the card receipt) → `draft` (editable this turn) → `final` (frozen).
- **Board ids increase monotonically** and are never reused after deletion, so a new board cannot collide with an old card's node.

More design details (in Chinese): [docs/设计文档.md](docs/设计文档.md).

## Known limitations

- **GeoGebra CDN dependency**: loaded from `geogebra.org` by default; offline/intranet setups need a local codebase (configuration not exposed yet).
- **GeoGebra native undo defect**: undoing a polygon can detach its edges from the fill and corrupt coordinates. This is a GeoGebra 6 issue; the plugin keeps native behaviour and only repaints after undo. A broken board can be fixed with "Restore" to the Agent's original version.
- **Image export is not implemented yet**: only `.ggb` is supported; PNG/SVG/PDF require the board to be visible and are planned.
- **No automatic cleanup**: board data lives under `<DSH_HOME>/geogebra/boards/`; uninstalling the plugin does not remove it.
- **Legacy cards are not supported**: records from the pre-0.1.0 test builds (`plugin:dsh-geogebra/board`) are no longer rendered; the released plugin writes `plugin:dsh-geogebra-chat/board`.

## Development

```bash
pnpm install
pnpm build        # lib/index.js + lib/client.js
pnpm watch        # incremental build while developing
```

Layout:

| Path | Content |
|---|---|
| `src/index.ts` | Host half: tools, system prompt, HTTP routes |
| `src/boards.ts` | Board store: create, amend, freeze, receipt, persistence |
| `src/command-lint.ts` | Command-name pre-check and white-object guard |
| `src/client/index.tsx` | Browser half: iframe, card, conversation node |
| `src/command-names.json` | Command names generated from the official manual |
| `scripts/` | Build and development probes |
| `docs/设计文档.md` | Design, APIs, data model, known risks (Chinese) |

## Roadmap

- [ ] PNG / SVG / PDF export
- [ ] Offline GeoGebra codebase configuration
- [ ] Sidebar "continue drawing" (independent copy)
- [ ] Per-app command allowlist
- [ ] More complete automated tests

## License

Plugin code is MIT, see [LICENSE](LICENSE).

GeoGebra is licensed by the International GeoGebra Institute under the [GeoGebra License](https://www.geogebra.org/license). This repository **does not** contain GeoGebra code; it is loaded from the official CDN by default. See [NOTICE](NOTICE) for the third-party notice.

---

This repository is developed with AI assistance (commits carry `AI-Generated: true`). The current version was written entirely by AI (DeepSeek); human review is planned.
