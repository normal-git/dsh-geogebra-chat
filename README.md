# DSH GeoGebra Chat

**在 DeepSeek Harness 的对话里直接画 GeoGebra。** 每画一次生成一张独立、不可变的快照板；讲解、改图、接着画，都发生在对话里。

[DeepSeek Harness](https://github.com/deepseek-ai) · GeoGebra 6 · MIT

![卡片示例](assets/card.png)

> **状态：0.1.0 实验版。** 已在 DSH `0.2.1-rc.2` 上验证。DSH 的插件接口仍在演进，升级 DSH 后可能需要跟着调整。

---

## 它解决什么问题

普通"AI 画图"通常是生成一张静态图片，或者共享一块会被反复覆盖的画布。讲数学题时，这会遇到两个问题：

1. **历史被覆盖**：画完第一种情况再画第二种，第一种就没了；
2. **AI 不记得自己画过什么**：上下文一长，对象名、依赖关系就开始编。

这个插件把画板做成**不可变快照**：

- 每次 `create` 都是新板，旧板永远保留；
- 想基于旧板继续，就复制它的 XML 生成新板，而不是原地修改；
- 宿主保存完整的 XML、`.ggb` 和对象清单，Agent 每次从工具拿"权威清单"，不靠记忆；
- 同一回合内画错了，可以用 `amend` 补发命令，不会留下失败板。

## 快速开始

把包装进 DSH 环境后，在 profile 的 patch 里注册：

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '@normal-git/dsh-geogebra-chat'
```

从源码开发时，直接指向 `src/index.ts`（必须是绝对路径）：

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '<path-to-plugin>/src/index.ts'
```

启动：

```bash
dsh --profile <name> --patch <path-to-patch>.yml web --port 3099 --no-open
```

不需要配置 GeoGebra：默认从 CDN 加载。

## 怎么用

直接对 Agent 说人话即可：

> 画一个边长 2 的正方形，再画它的外接圆。

Agent 会调用 `geogebra_create`，对话里出现一张卡片。卡片上可以：

| 操作 | 说明 |
|---|---|
| 折叠 / 展开 | 折叠状态按会话+板号记住，换对话回来仍折叠 |
| 拖拽底部 | 调整画板高度 |
| 显示代数区 | 打开 GeoGebra 左侧代数栏 |
| 还原 | 回到 Agent 刚生成的样子；再按一次撤销可回到你调整后的版本 |
| 删除 | 两步确认，删除后变成"已被删除"灰条 |
| 滚轮 | 鼠标悬停即可缩放画板 |

想接着画：

> 在这个正方形里画一条对角线。

Agent 会先 `geogebra_check` 看当前状态，再基于旧板生成一张新板。

## 工具

| 工具 | 作用 |
|---|---|
| `geogebra_create` | 新建一张板（必须起名，可 `from` 旧板） |
| `geogebra_amend` | 本轮内补发/修正命令，已有对象保留 |
| `geogebra_commit` | 提前冻结草稿 |
| `geogebra_check` | 用户改了什么、当前清单 |
| `geogebra_inspect` | 某个对象的定义/数值 |
| `geogebra_rename` | 改名（编号不变） |
| `geogebra_list` | 列出本会话所有板 |
| `geogebra_export` | 导出 `.ggb`（当前版 / Agent 原版） |
| `geogebra_delete` | 删除一张板（只在用户明确要求时） |

工具返回的是 GeoGebra 自己产出的**构造清单**（对象、类型、定义、文本），不返回 XML / base64 / 图片，避免把上下文撑爆。

## 工作原理

```
Agent ── geogebra_create ──▶ Host 板仓库（XML / .ggb / 清单）
                                   │
                                   ▼
                        对话节点：一张 board 卡片
                                   │
                            iframe 里的 GeoGebra
```

- **宿主是唯一事实来源**：板记录写成 JSON，放在 `<DSH_HOME>/geogebra/boards/<session>/`；
- **卡片只是渲染器**：卡片卸载、页面刷新、DSH 重启，板都不会丢；
- **每张板三个状态**：`creating`（等卡片回执）→ `draft`（本轮可改）→ `final`（冻结）；
- **板号单调递增**，删除后不回收，避免新板撞进旧卡片的节点。

更多设计细节见 [docs/设计文档.md](docs/设计文档.md)。

## 已知限制

- **依赖 GeoGebra CDN**：默认从 `geogebra.org` 加载；离线/内网需要自备 codebase（配置项尚未暴露）。
- **GeoGebra 原生撤销的缺陷**：撤销多边形后，边与填充可能分离、坐标被写坏。这是 GeoGebra 6 自身的问题；插件保留原生行为，只在撤销后主动重绘。坏掉的板可以点"还原"回到 Agent 原版。
- **图片导出未实现**：目前只能导出 `.ggb`；PNG / SVG / PDF 需要画板可见，计划中。
- **数据不会自动清理**：板数据在 `<DSH_HOME>/geogebra/boards/`，卸载插件不会删除。
- **旧卡片不兼容**：0.1.0 之前的测试版记录类型（`plugin:dsh-geogebra/board`）不再渲染；正式版统一为 `plugin:dsh-geogebra-chat/board`。

## 开发

```bash
pnpm install
pnpm build        # lib/index.js + lib/client.js
pnpm watch        # 开发时增量构建
```

目录：

| 路径 | 内容 |
|---|---|
| `src/index.ts` | 宿主半：工具、系统提示词、HTTP 路由 |
| `src/boards.ts` | 板仓库：创建、修正、冻结、回执、持久化 |
| `src/command-lint.ts` | 指令名预校验 + 白色对象拦截 |
| `src/client/index.tsx` | 浏览器半：iframe、卡片、对话节点 |
| `src/command-names.json` | 从官方手册生成的指令名表 |
| `scripts/` | 构建与开发探针 |
| `docs/设计文档.md` | 设计、接口、数据模型、已知风险 |

## Roadmap

- [ ] PNG / SVG / PDF 导出
- [ ] 离线 GeoGebra codebase 配置
- [ ] 侧栏"继续画"（独立副本）
- [ ] 按 app 的指令白名单
- [ ] 更完整的自动化测试

## 许可

插件代码 MIT，见 [LICENSE](LICENSE)。

GeoGebra 由 International GeoGebra Institute 授权，使用受 [GeoGebra License](https://www.geogebra.org/license) 约束；本仓库**不包含** GeoGebra 代码，默认从官方 CDN 加载。第三方声明见 [NOTICE](NOTICE)。

---

## English

**DSH GeoGebra Chat** embeds interactive GeoGebra boards into DeepSeek Harness conversations. Every `create` produces a new immutable snapshot board, so earlier constructions are never overwritten; the host owns the XML/`.ggb`/construction sheet, and the chat card is only a renderer. Agent tools return GeoGebra's own construction sheet so the model always works from an authoritative state instead of memory.

MIT plugin. GeoGebra itself is not bundled and is loaded from the official CDN.
