# DSH GeoGebra Chat

Draw GeoGebra inside DeepSeek Harness conversations. Every drawing creates a separate snapshot board, so earlier drawings are not overwritten.

[DeepSeek Harness](https://github.com/deepseek-ai) · GeoGebra 6 · MIT

![Board card](assets/card.png)

> Status: experimental 0.1.0, tested on DSH `0.2.1-rc.2`. Plugin APIs are still changing; you may need to adjust after upgrading DSH.

This version was written entirely by AI (DeepSeek). Human review is planned. Please use it as an experimental version.

中文说明：[docs/README.zh-CN.md](docs/README.zh-CN.md)

## Background

With typical "AI drawing", you either get a static image, or one shared canvas where later drawings cover earlier ones. That gets awkward when teaching math: draw the second case and the first is gone; as the context grows, the model also starts losing track of which objects it created.

This plugin stores each drawing as a separate board:

- `create` always makes a new board; old boards stay as they are;
- to continue, seed a new board from the old board's XML instead of editing the old one;
- the host stores the XML, `.ggb` and object list; the Agent reads the list from a tool every time instead of relying on memory;
- if a command is wrong, `amend` resends it in the same turn, leaving no failed board behind.

## Quick start

After installing the package into your DSH environment, register it in the profile patch:

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '@normal-git/dsh-geogebra-chat'
```

For source development, point directly at `src/index.ts` (absolute path):

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '<path-to-plugin>/src/index.ts'
```

Start:

```bash
dsh --profile <name> --patch <path-to-patch>.yml web --port 3099 --no-open
```

No GeoGebra configuration needed; it loads from the CDN by default.

## Usage

Talk to the Agent in plain words:

> Draw a square with side length 2, then draw its circumscribed circle.

The Agent calls `geogebra_create`, and a card appears in the conversation. On the card:

| Action | Description |
|---|---|
| Fold / expand | Fold state is remembered by session and board id |
| Drag the bottom edge | Resize the board |
| Show algebra | Open GeoGebra's left algebra pane |
| Restore | Return to the Agent's version; one more undo returns your edits |
| Delete | Requires confirmation; leaves a "deleted" note |
| Wheel | Hover to zoom |

Continue:

> Draw a diagonal inside this square.

The Agent first calls `geogebra_check`, then creates a new board from the old one.

## Tools

| Tool | Purpose |
|---|---|
| `geogebra_create` | Create a board (name required; optional `from` an old board) |
| `geogebra_amend` | Resend or fix commands in the same turn, keeping existing objects |
| `geogebra_commit` | Freeze a draft early |
| `geogebra_check` | What the user changed, plus the current sheet |
| `geogebra_inspect` | Definition or value of one object |
| `geogebra_rename` | Rename a board (id stays the same) |
| `geogebra_list` | List boards in this session |
| `geogebra_export` | Export `.ggb` (current or Agent-original version) |
| `geogebra_modes` | List app modes and their capabilities; use when unsure about `appName` |
| `geogebra_delete` | Delete a board (only when the user asks) |

Tools return GeoGebra's own object list (labels, types, definitions, text), not XML or images, to keep context usage down.

Modes: `suite` (default), `classic`, `graphing`, `geometry`, `3d`, `scientific` and others. Constructions with `(x,y,z)` coordinates switch to `3d` automatically, and 3D cards render in the 3D view. When unsure, the Agent calls `geogebra_modes` first.

## How it works

```
Agent ── geogebra_create ──▶ Host board store (XML / .ggb / object list)
                                    │
                                    ▼
                       Conversation node: one board card
                                    │
                            GeoGebra inside an iframe
```

- Board records are JSON, stored under `<DSH_HOME>/geogebra/boards/<session>/`;
- The card is only a renderer; unmounting it, refreshing the page, or restarting DSH will not lose boards;
- A board goes `creating` → `draft` (editable this turn) → `final` (frozen);
- Board ids only increase and are not reused after deletion, so a new board will not collide with an old card's node.

## Limitations

- GeoGebra loads from `geogebra.org`; offline or intranet use needs a local package, and that option is not implemented yet.
- Only `.ggb` export is available for now. PNG, SVG, PDF need the board visible; planned.
- Data under `<DSH_HOME>/geogebra/boards/` is not deleted automatically when the plugin is uninstalled.

## Development

```bash
pnpm install
pnpm build        # lib/index.js + lib/client.js
pnpm watch        # incremental build while developing
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
- [ ] Offline GeoGebra package
- [ ] Sidebar "continue drawing"
- [ ] Limit available commands per app
- [ ] More automated tests

## License

Plugin code is MIT; see [LICENSE](LICENSE).

GeoGebra is licensed by the International GeoGebra Institute under the [GeoGebra License](https://www.geogebra.org/license). This repository does not contain GeoGebra; it loads it from the official CDN by default. See [NOTICE](NOTICE) for the third-party notice.

Development is AI-assisted; commits carry `AI-Generated: true`.
