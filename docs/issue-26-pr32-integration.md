# PR #32 最终整合

2026-10-28 用户选择冲突处保留 main 最新实现。整合基线 origin/main 398d58c；当前主线已通过 #36 等后续交付包含棉花糖确认手感、预设、多样式表面适配和蜡壳交互，因此本次不再覆盖产品源码。黏土、慢回弹、棉花糖及全部输入/场景采用主线版本。

原分支用户确认记录：2026-10-23 保存 marshmallow 预设。跨样式使用 createOrbPreview(mount, { presetId: 'marshmallow' })，或 getOrbPreset('marshmallow')，按主线最新文档与模型适配调用，禁止复制算法重调参数。

同名历史证据冲突保留主线文件；本分支确认版的冲突录屏、截图和测量另存 artifacts/issue-26/pr32-confirmed-history/，只作历史记录，不声称代表最新蜡壳或多样式。原本地123/123通过的历史日志仍在 local-contact/final-suite.txt。合并后验证见本PR说明。

回滚本次整合记录不应回滚主线既有产品功能；需要撤回产品行为时另立修复PR。关联 #26，不自动关闭其他Issue。
