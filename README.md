# DSH GeoGebra Chat

GeoGebra boards inside DeepSeek Harness conversations. Each drawing becomes its own snapshot board, so earlier work is never overwritten.

[DeepSeek Harness](https://github.com/deepseek-ai) · GeoGebra 6 · MIT

![Board card](assets/card.png)

> Status: experimental 0.1.0, tested on DSH `0.2.1-rc.2`. Plugin APIs are still moving, so upgrades may need changes.

This version was written entirely by AI (DeepSeek). Human review is planned. Use it with that in mind.

中文说明：[docs/README.zh-CN.md](docs/README.zh-CN.md)

## Background

A typical "AI draws a picture" flow gives you a static image, or one shared canvas that later drawings overwrite. That is awkward for teaching: the first case disappears when you draw the second, and the model eventually forgets which objects it created.

This plugin keeps each drawing as its own board:

- `create` always makes a new board; older boards stay as they are.
- Continuing from a board seeds a new one from its XML instead of editing the old one.
- The host keeps the XML, the `.ggb` file and the object list. The agent reads the list from a tool instead of memory.
- If a construction is wrong, `amend` fixes it in the same turn, without leaving a broken board behind.

## Getting started

Install the package into your DSH environment, then register it in the profile patch:

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '@normal-git/dsh-geogebra-chat'
```

For development from source, point at `src/index.ts` (absolute path):

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '<path-to-plugin>/src/index.ts'
```

Start DSH:

```bash
dsh --profile <name> --patch <path-to-patch>.yml web --port 3099 --no-open
```

No GeoGebra setup is needed; it loads from the CDN.

## Using it

Ask the Agent in plain language:

> Draw a square with side length 2, then draw its circumscribed circle.

The Agent calls `geogebra_create`, and a card appears in the conversation. On the card:

| Action | What it does |
|---|---|
| Fold / expand | Folded state is remembered per session and board |
| Drag the bottom edge | Resize the board |
| Show algebra | Open GeoGebra's algebra pane |
| Restore | Go back to the Agent's version; one undo returns your edits |
| Delete | Asks for confirmation, then leaves a "deleted" tombstone |
| Wheel | Hover and scroll to zoom |

To continue:

> Draw a diagonal inside this square.

The Agent calls `geogebra_check` first, then creates a new board from the old one.

## Tools

| Tool | Purpose |
|---|---|
| `geogebra_create` | Create a board (name required; optional `from` an old board) |
| `geogebra_amend` | Resend/fix commands in the same turn, keeping existing objects |
| `geogebra_commit` | Freeze a draft early |
| `geogebra_check` | What the user changed, plus the current sheet |
| `geogebra_inspect` | Definition or value of one object |
| `geogebra_rename` | Rename a board (id stays the same) |
| `geogebra_list` | List boards in this session |
| `geogebra_export` | Export `.ggb` (current or Agent-original version) |
| `geogebra_delete` | Delete a board (only when the user asks) |

Tools return GeoGebra's own object list (labels, types, definitions, text), not XML or images, to keep model context small.

## How it works

```
Agent ── geogebra_create ──▶ Host board store (XML / .ggb / object list)
                                    │
                                    ▼
                       Conversation node: one board card
                                    │
                            GeoGebra inside an iframe
```

- Board records are JSON files under `<DSH_HOME>/geogebra/boards/<session>/`.
- The card is only a renderer. Unmounting it, reloading the page or restarting DSH does not lose boards.
- A board goes `creating` → `draft` (editable this turn) → `final` (frozen).
- Board ids only go up and are never reused, so a new board cannot collide with an old card's node.

## Limitations

- GeoGebra loads from `geogebra.org`. Offline or intranet setups need a local build; that option is not exposed yet.
- GeoGebra's native undo can break polygons: after undo, edges may detach from the fill and coordinates can be corrupted. That is a GeoGebra 6 issue. The plugin keeps native undo and repaints afterwards. A broken board can be restored to the Agent's version.
- Only `.ggb` export is available. PNG/SVG/PDF need the board rendered and are planned.
- Board data under `<DSH_HOME>/geogebra/boards/` is not removed when the plugin is uninstalled.
- Boards created by the pre-0.1.0 test builds (`plugin:dsh-geogebra/board`) are not shown. The released plugin uses `plugin:dsh-geogebra-chat/board`.

## Development

```bash
pnpm install
pnpm build        # lib/index.js + lib/client.js
pnpm watch        # incremental build
```

| Path | Content |
|---|---|
| `src/index.ts` | Host half: tools, system prompt, HTTP routes |
| `src/boards.ts` | Board store: create, amend, freeze, receipt, persistence |
| `src/command-lint.ts` | Command-name check and white-object guard |
| `src/client/index.tsx` | Browser half: iframe, card, conversation node |
| `src/command-names.json` | Command names generated from the official manual |
| `scripts/` | Build and development probes |

## Roadmap

- [ ] PNG / SVG / PDF export
- [ ] Offline GeoGebra build
- [ ] Sidebar "continue drawing" (independent copy)
- [ ] Per-app command allowlist
- [ ] More automated tests

## License

Plugin code is MIT; see [LICENSE](LICENSE).

GeoGebra is licensed by the International GeoGebra Institute under the [GeoGebra License](https://www.geogebra.org/license). This repository does not contain GeoGebra; it loads it from the official CDN. See [NOTICE](NOTICE).

Development is AI-assisted; commits carry `AI-Generated: true`.
