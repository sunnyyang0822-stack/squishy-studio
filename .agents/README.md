# 项目级设计与动效技能

本项目安装了 [emilkowalski/skills](https://github.com/emilkowalski/skills) 的整套 15 个技能，以及 [Impeccable](https://github.com/pbakaus/impeccable) 的 Codex 版统一技能，位于 `.agents/skills/`。它们不是网站运行依赖，不会自动安装其中提到的 UI、动画或原生应用库。

## 使用

在本项目的下一轮对话中可使用技能名称，例如：

- `$emil-design-eng`：界面细节与整体设计质量。
- `$animate`：设计并实现网页动画。
- `$animation-performance`：排查动画性能。
- `$mobile-native`：手机网页体验。
- `$review-animations`：审查已有动效。
- `$impeccable`：统一的界面设计、审查和打磨入口，例如 `$impeccable audit` 或 `$impeccable polish`。

完整集合还包含 `animate-expo`、`animation-vocabulary`、`apple-design`、`ask-sonner`、`break-ui`、`find-animation-opportunities`、`improve-animations`、`pick-ui-library`、`prototype` 和 `write-swift`。仅在任务需要时使用；原生应用技能不会改变本项目 Web-first 的方向。

使用技能仍须遵守项目 `AGENTS.md`、用户明确要求和已确认的产品范围。技能中的示例和库建议不构成修改依赖或扩展产品的授权。

Impeccable 配套命令入口位于 `skills/impeccable/scripts/`，Windows 使用 `impeccable.cmd`，其他系统使用 `impeccable`。首次运行会下载带校验的版本化引擎到用户缓存；安装技能不会自动运行 `init`、生成产品文档或启用编辑 hooks。

## 在其他对话和项目使用

项目目录随仓库共享；同一台电脑上跨项目使用，应将技能安装到当前用户的 `~/.agents/skills/`。本次也在当前用户目录安装了两套相同来源版本的技能，可在其他项目的新对话中按名称调用。

技能是否可发现与是否在某次任务中被选用是两件事。可明确写 `$emil-design-eng` 或 `$impeccable`；若对话未显示新技能，先检查技能列表，再刷新或重启 Codex。项目级和用户级同名条目可能同时显示，可按路径区分。

用户级文件只属于当前电脑和操作系统账号，不会通过 Git 自动同步到另一台电脑、远程环境或其他聊天产品。更换环境时，应在该环境安装或使用包含项目技能的仓库检出。

## 来源与完整性

- 上游提交：[`2d228630ba1446365f614a108cb8252f1feda202`](https://github.com/emilkowalski/skills/commit/2d228630ba1446365f614a108cb8252f1feda202)。
- [来源清单](skill-sources/emilkowalski/source.json)记录技能列表、原始路径与 Git blob 校验值。
- [MIT 许可证](skill-sources/emilkowalski/LICENSE)和[性能速查表](skill-sources/emilkowalski/performance-cheatsheet.md)随项目保留。
- 技能及配套资源保持上游原文，校验时仅统一文本换行。
- Impeccable 上游提交：[`0665bd812ae0908fcab17b96fd4f840defb882d9`](https://github.com/pbakaus/impeccable/commit/0665bd812ae0908fcab17b96fd4f840defb882d9)，安装路径为上游 `.agents/skills/impeccable/`。
- Impeccable 的[来源清单](skill-sources/impeccable/source.json)、[Apache 2.0 许可证](skill-sources/impeccable/LICENSE)和[NOTICE](skill-sources/impeccable/NOTICE.md)单独保留，不改变本项目原有许可证。
- 保留上游自带的结尾空行，由校验值验证原文；Windows 命令入口在工作区使用 CRLF，Git 中按文本存储。

## 验证与更新

运行 `node --test tests/skills.test.cjs` 验证入口、内容完整性及本地文档引用；`npm test` 也会包含这些检查。

更新时先审查新的上游提交，在临时目录用 skill-installer 安装对应 `skills/<名称>` 路径，再比较差异。同步更新技能、配套文件、许可证与来源清单，运行完整验证并按项目规则创建 PR。不要删除清单检查来接受不明来源的修改。
