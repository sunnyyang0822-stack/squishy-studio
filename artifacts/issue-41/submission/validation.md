# 中蜡21组合集成验证 — 2026-11-05

## 2026-11-06最新薄蜡主线集成

## 2026-11-06中蜡排队释放修正

强制SwiftShader复现出实际宿主问题：棉花糖松手补算时仍保持壳体active，补算耗时进入驻留；手机释放排队期间还可能继续施力。修正仅中蜡：当前帧时间传给wax.step，检测离散输入待处理时让出新的施力帧，松手前先结束壳体再完整补算内芯路径。没有改变阈值、手感、几何、碎块或掉落参数。

修正前强制软件渲染的云朵短按误掉3片（`software-input-before.txt`）；仅修时钟仍有手机失败（`software-clock-only.txt`），中间一次服务中断也保留（`software-clock-interrupted.txt`）。完整释放修正后，`MEDIUM_WAX_TEST_DPR=0.125 THIN_WAX_SOFTWARE_GL=1 STYLES_REVIEW_CASE=cloud node --test tests/medium-wax-core-browser.test.cjs`：1/1、exit 0，云朵×棉花糖/慢回弹×桌面/手机模拟4组全部零短按掉片、完整几何无违规、长按仍掉落（`software-release-final.txt`，原调用通过临时preload注入相同SwiftShader启动参数，随后加入正式环境开关）。其中手机pointerup处理延迟超过1秒仍不误碎；不是性能流畅性验收。

`node --test tests/medium-wax-release-browser.test.cjs`：1/1、exit 0，`release-deterministic.txt`。固定模拟离散释放在队列中，仍用真实键盘事件驱动共享输入，验证排队期间零新增碎片、松手完整提交内芯最终形变且冻结、再次真正长按仍碎裂。首轮测试漏装探针导致的准备超时保留在`release-deterministic-initial.txt`，修正为直接等待场景和诊断就绪；不放宽行为断言。原中蜡时序专项1/1、exit 0（`medium-clock-unit.txt`），构建exit 0（`release-build.txt`）。最终CI仍须对新head重新通过。

等待CI期间主线发布PR57；本分支已通过`893cbc7`集成`b65038c`。保留薄蜡的21组合、compactPanels采样、附着片缓存、懒法线、精确平局查询与厚度标量计算。中蜡参数、源面分区和自身性能开关保持；显式关闭中蜡的新cacheAttachedPanels以隔离两套已确认缓存配置。无工厂或场景复制。

- `node --test --test-concurrency=1 tests/medium-wax-core-flow.test.cjs tests/medium-wax-regions.test.cjs tests/wax-cloud-reuse.test.cjs tests/wax-compact-panels.test.cjs tests/wax-compact-support.test.cjs tests/surface-thickness-scalar.test.cjs tests/wax-feature-normals.test.cjs tests/wax-collision-cache.test.cjs tests/detail-state.test.cjs tests/thin-wax-approved-scope.test.cjs`：40/40，exit 0，`latest-thin-integration.txt`。
- `node --test --test-concurrency=1 tests/medium-wax-performance.test.cjs tests/medium-wax-query-refit.test.cjs tests/thick-wax.test.cjs tests/wax-compact-fall.test.cjs`：21/21，exit 0，`latest-medium-reference.txt`，中蜡优化开关的实际几何误差0，完整采样无违规；薄蜡紧凑片的下落轨迹与厚蜡回归通过。
- `npm run build:orb`：exit 0，`latest-build.txt`。
- `MEDIUM_WAX_TEST_DPR=0.125 STYLES_REVIEW_CASE=cloud,donut node --test tests/medium-wax-core-browser.test.cjs`（PowerShell环境变量逐项设置）：1/1聚合测试、exit 0，覆盖云朵/甜甜圈×棉花糖/慢回弹×桌面白天/手机模拟夜间8组，以及三种猫爪排除，`latest-browser-integration.txt`。完整矩阵仍由最终CI重新执行。

下面350项首轮CPU与30项浏览器记录属于集成PR57前的正式版本；最新集成以本节输出及最终PR检查为准，不冒称旧输出对应最新构建。

预设：**中蜡·双倍薄蜡厚度**，`getWaxPreset('medium-wax')`。
明确基线：`origin/main` = `257d546fab954854e885363335dd64a7baf99d20`；集成提交 `375d834` 保留原分支及最新main历史，不覆盖厚蜡、指甲油、圆球模型或灯光。

## 支持矩阵与边界

`recipes.json` 是当前流程判定实际生成的21个可启用配方：圆球、云朵、圆柱、甜甜圈、三角锥、花朵、五角星 × clay、marshmallow、butter（slow-rebound）。三种猫爪均排除。外壳/装饰制作预览支持21组合，最终试捏仍只有既有圆球黏土中蜡；没有扩大最终流程。

实体厚度0.028模型单位（薄蜡0.014，两倍）、间隙0.004、驻留0.5秒，原内芯参数、碎块尺寸及掉落规则不改。表面分区为96种子；猫爪历史实验不列入支持。

## 正式源码与构建

工作目录：`D:\squishy-studio\.worktrees\issue-41-medium-wax`。Windows Node v24.21.0、Edge真实WebGL；GitHub工作流另用Node22/full Chromium。

构建：`npm run build`、随后 `npm run build:orb`，均exit 0。`build.txt`为最终预览构建的真实输出。`assets/orb-preview.js` SHA256：`3be42d324f564a171f375e390c15abfe2d90d2b5bed49106006a1e410f5d00f6`。

- `node --test --test-concurrency=1 tests/medium-wax-core-flow.test.cjs tests/detail-state.test.cjs tests/wax-presets.test.cjs tests/thick-wax-flow.test.cjs tests/polish-flow.test.cjs`：52/52，exit 0，`flow-final.txt`。
- `node --test tests/medium-wax.test.cjs`：7/7，exit 0，`medium-final.txt`。
- `node --test tests/thick-wax.test.cjs`：4/4，exit 0，`thick-final.txt`。
- `node --test tests/repository.test.cjs tests/skills.test.cjs`：6/6，exit 0，`repository.txt`。
- `node --test --test-concurrency=1 tests/medium-wax-core-browser.test.cjs tests/medium-wax-browser.test.cjs tests/medium-wax-style-mobile.test.cjs tests/detail.test.cjs tests/thick-wax-browser.test.cjs tests/thick-wax-orb-cores-browser.test.cjs tests/polish-browser.test.cjs`：30/30，exit 0，`browser.txt`。

浏览器涵盖七样式×棉花糖/慢回弹×桌面白天/手机模拟夜间28组（`core-browser-summary.json`）、七种黏土手机昼夜、圆球薄/中四环境对照、可信短按无误掉片、持续碎裂、松手、拖动、旋转、完整几何、重开、切厚度及资源释放，以及制作流程、厚蜡三内芯和指甲油回归。不是每一组合的四环境完整交叉，也没有手机真机/Safari结论。

53文件CPU回归由`cpu-test-files.json`记录实际文件清单，按 `node --test --test-concurrency=1` 加该清单执行；输出保留在`cpu.txt`：350项，348通过、2失败、exit 1。两条失败均为旧范围预期：黏土猫爪可重开，以及“中蜡尚未交付应报错”。前者改为21组合范围后同文件7项已完整重跑通过；后者改为中/厚预设独立及参数隔离检查。最终修复后的专项结果另存`thick-final.txt`；不能将首轮称为全绿。CI对最终提交重新完整运行，合并前必须通过。

最初流程试跑中的旧预设清单/厚蜡重开预期失败保留在`initial-flow-failure.txt`，更新为三个预设与现有厚蜡范围后52项通过。没有放宽几何容差、删减碰撞采样或延长驻留阈值来获得通过。归档文本仅删除空行尾部空格以满足Git空白检查，原始文本仍在忽略的`.tmp/issue-41`。

## 最新模型测量与历史视觉证据

首轮GitHub运行41978147496（head 40877cb）发现两条浏览器测试适配问题，摘录在`ci-shard4/5-failure-excerpt.txt`，完整原日志在忽略目录。资源切换测试用固定850ms准备损伤，软件渲染没有及时掉片；改为在最多10秒内等待真实损伤后松手，时序专项不变。本地 `node --test --test-name-pattern="rapid thickness changes" tests/medium-wax-browser.test.cjs` 1/1、exit 0，见`ci-lifecycle-fix-local.txt`。

第二轮运行41979650986（head 3db497f）有4个分片及汇总门禁失败，原错误摘录保留。资源切换已通过；薄/中匹配对照仍有等待按下ACK后才计时导致的短按延长，现改为墙钟180ms独立释放并沿用0.5栅格。本地`THIN_WAX_TEST_DPR=0.5 node --test tests/medium-wax-browser.test.cjs` 5/5、exit 0，见`ci-matched-input-local.txt`。复杂样式0.5栅格仍有软件呈现造成排队，CI单独采用与现有飞行测试相同的0.125软件栅格（`MEDIUM_WAX_TEST_DPR`），CSS视口、核心几何、采样、真实输入、160ms和零误掉片均不变；本地云朵两内芯×两环境4组通过、exit 0，见`ci-dense-raster-input-local.txt`。原1x本地28组结果仍保留，不把低栅格CI当成设备视觉验收。

第二轮还暴露旧范围断言：棉花糖薄蜡切中蜡原来等待禁用，现明确断言非猫爪中蜡启用、实际厚度0.028及完整几何，再切回薄蜡检查独立状态；八款导航测试均已本地通过。最初混合试跑`ci-scope-navigation-initial.txt`中8项通过、1项尝试修改默认中蜡换色测试的矩阵预期失败，保留真实exit 1。最终换色测试明确选择未实现糖壳以保持原裸芯自动恢复契约，GPU/位置/矩阵/画布复用断言不放宽；`node --test --test-name-pattern="同色无外壳" tests/orb-color.test.cjs` 1/1、exit 0，见`ci-color-legacy-final.txt`。默认中蜡导航损伤保留由中蜡专项覆盖。工作流契约2/2通过，见`ci-raster-workflow-local.txt`。产品源码与参数在这两轮适配中没有变化。

另一个新增测试默认1x栅格，日志中160ms短按的pointerup处理延迟超过0.5秒而掉片；现沿用工作流已有`THIN_WAX_TEST_DPR=0.5`设置，CSS尺寸、真实操作、160ms短按、零掉片断言和完整几何均不变。本地设置`THIN_WAX_TEST_DPR=0.5 STYLES_REVIEW_CASE=orb`运行`node --test tests/medium-wax-core-browser.test.cjs`，圆球两内芯×两环境4组及三种猫爪排除通过，exit 0，见`ci-raster-input-local.txt`。没有更改产品输入或阈值，也未删减几何采样。

最新圆球覆盖源面积薄/中均约12.55121814；分区180/96。薄/中均值0.069728989678/0.130741855634，平均面积比1.875；中位0.063840750425/0.122996631211，比1.926616；中蜡面积范围0.031303341373–0.270421215210、CV0.415115064589。实体厚度误差约1.10e-7模型单位，未放大模型或掉落显示比例。实测原始值位于`medium-final.txt`。

最新main已更新圆球模型，旧模型面积数值只作历史证据。已确认候选录像、匹配操作和昼夜/桌面/手机模拟证据索引在`../approved-medium/validation.md`，每份证据记录自身版本，不冒称是本次集成后的录像。最新浏览器截图位于忽略的`.tmp/issue-41/medium-wax-core-browser`。本轮功能回归与CPU测试并行，观察帧间隔不能用作独立性能对比；专门A/B原始间隔仍在`approved-medium`。复杂样式可能有慢帧，不承诺全款60fps。

## 范围与回滚

不提交临时浏览器目录、指甲油回归自动生成物或秘密；仓库保持Public。不修改其他任务Issue/PR，不自动关闭#41、#38、#22。回滚此PR的合并提交并重建，无数据迁移；不要回滚其他协作者的预设或模型。
