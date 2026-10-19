# DSH GeoGebra Chat

把 GeoGebra 画板嵌进 [DeepSeek Harness](https://github.com/deepseek-ai) 的对话：Agent 每画一次生成一张**独立、不可变的快照板**，历史永远保留；想接着画，就以旧板为底稿生成新板。

![卡片示例](assets/card.png)

> **状态：0.1.0 实验版。** 已在 DSH `0.2.1-rc.2` 上验证；接口仍可能随 DSH 升级调整。

## 特点

- **一次一张、互不影响**：每张板有自己的编号（`b1`）和名字（`正方体3D`），旧板不会被后来的操作覆盖。
- **宿主持有权威状态**：XML、`.ggb`、构造清单都在宿主侧；卡片只是渲染器，卸载/刷新/重启都不丢。
- **精确清单**：工具返回 GeoGebra 自己产出的对象清单，Agent 不靠记忆。
- **同轮可修正**：命令失败时用 `geogebra_amend` 在同一回合补发，不会留下失败画板。
- **默认 suite**：新版界面、指令最全；纯函数图可显式用 `graphing`。
- **卡片交互**：折叠（状态记忆）、拖拽调高、显示代数区、还原、删除；滚轮悬停即可缩放。
- **离线可选**：默认从 GeoGebra CDN 加载；可配置本地 codebase，主仓库不包含 GeoGebra。

## 安装

把包装进你的 DSH 环境后，在 profile 的 patch 里注册：

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '@normal-git/dsh-geogebra-chat'
```

从源码开发时，直接把 `name` 指向 `src/index.ts`（绝对路径）：

```yaml
- insert:
    - id: dsh-geogebra-chat
      name: '<path-to-plugin>/src/index.ts'
```

然后：

```bash
dsh --profile <name> --patch <path-to-patch>.yml web --port 3099 --no-open
```

## 构建

```bash
pnpm install
pnpm build      # 生成 lib/index.js 与 lib/client.js
```

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
| `geogebra_export` | 导出 `.ggb`（当前版/原版） |
| `geogebra_delete` | 删除一张板（只在用户明确要求时） |

## 已知限制

- **依赖 GeoGebra CDN**：默认从 `geogebra.org` 加载；离线/内网需自备 codebase（配置项尚未暴露）。
- **GeoGebra 原生撤销的已知缺陷**：撤销多边形后，边与填充可能分离、坐标被写坏。这是 GeoGebra 6 自身的问题；插件保留原生行为，只在撤销后主动重绘。坏掉的板可以点"还原"回到 Agent 原版。
- **图片导出未实现**：目前只能导出 `.ggb`（PNG/SVG/PDF 需要画板可见，计划中）。
- **数据目录**：板数据写在 `<DSH_HOME>/geogebra/boards/`，卸载插件不会自动清理。

## 许可

插件代码 MIT。GeoGebra 由 International GeoGebra Institute 授权，使用受 [GeoGebra License](https://www.geogebra.org/license) 约束；本仓库不包含 GeoGebra 代码。

---

本仓库的提交由 AI 协作完成（提交信息带 `AI-Generated: true`）。
