# B：首版成品场景交接

## 核实基线与范围

从 `origin/main c140b5cd1d8aaacd3c9c7f5558911927b4f48974` 建立 `codex/wax-product-integration`，工作树位于项目内 `.worktrees/wax-product-integration`。

2026-11-21 通过 GitHub CLI 只读核实：[#3](https://github.com/sunnyyang0822-stack/squishy-studio/issues/3) OPEN，最新首版决策为「选造型 → 内芯试捏 → 独立壳片选配 → 合成过场 → 成品交互」，绘画移至第二版；[#38](https://github.com/sunnyyang0822-stack/squishy-studio/issues/38) OPEN；[#41](https://github.com/sunnyyang0822-stack/squishy-studio/issues/41) CLOSED；[#43](https://github.com/sunnyyang0822-stack/squishy-studio/issues/43) CLOSED；[#53](https://github.com/sunnyyang0822-stack/squishy-studio/issues/53) OPEN，猫爪全部套壳暂停。

薄蜡 PR #57、中蜡 PR #58、厚蜡 PR #51/#54/#60 已合并。#41/#43 的最终关闭说明明确：7 非猫爪造型 × 3 内芯只覆盖制作预览，最终带蜡壳仍限黏土圆球。#38 原始正文中 1 秒等历史描述不覆盖已确认预设的当前时序；本任务直接调用当前预设，不重新调参。指甲油 PR #55 已合并，复用其 `polish-shell`。

读过根目录最新 AGENTS.md、docs/orb-feels.md，以及 A 工作树 `docs/v1-making-handoff.md`（只读）。以下接口按 A 的提案实现。B 不改 `make/`、`detail/`、大厅、首页或作品存储；旧详情页的历史 `play` 门控保留，不能用旧详情页验收本次成品接口。A 需要在自己的 `make/providers.js` 导入此模块，完成顺序集成后再走新五段流程。

## A：稳定配方与生命周期

浏览器原生 ES 模块入口：`src/finished-scene.js`，无需新依赖或复制场景。

```js
import { createFinishedScene } from '/src/finished-scene.js';
const scene = createFinishedScene(mount, {
  onUnavailable(error) { /* WebGL 丢失后提供重试 */ },
  onState({ state, recipe, error }) { /* idle/loading/ready/failed/disposed */ },
  onEvent(event) { audio?.handleEvent(event); },
});
const recipe = {
  styleId: 'donut', coreMaterial: 'butter', coreColor: 'mint',
  shellMaterial: 'wax', shellColor: 'rose', waxThickness: 'thick',
};
if (!scene.supports(recipe)) { /* 阻止合成，呈现不支持信息 */ }
await scene.initialize(recipe, { signal });
await scene.update(nextRecipe, { signal });
scene.restore();
scene.stopInput();
scene.dispose();
```

- 六个字段与 A 一致。仅 `orb/cloud/cylinder/donut/pyramid/flower/star`；内芯 `clay/marshmallow/butter`，后者映射原 `slow-rebound + full-matte`。颜色使用 `detail/orb-colors.mjs` 的 ID。
- 蜡为 `thin/medium/thick`；指甲油有效配方必须 `waxThickness:null`。糖、猫爪、未知材质/颜色明确拒绝 `UNSUPPORTED_RECIPE`，不静默回退裸芯或改成圆球黏土。
- `initialize/update` 都返回首次真实绘制后的 Promise，GLB/引擎/渲染错误可失败；不能以模块已下载冒充场景就绪。同配方再次打开也重建完整损伤状态。实例切换仍用现有 `createModelPreview` 的 prepare/commit/dispose、revision 和 AbortSignal。
- 更新最新请求生效，旧异步准备被取消/释放。加载失败保留已提交场景，调用方可重试。停止输入、取消、失焦、后台沿原宿主流程；dispose 幂等并释放输入、rAF、WebGL、外壳和碎片。
- `restore()` 仅在 ready 且无 pending 更新时执行，复用原宿主的完整壳 `reset` 与芯/颜色/姿态恢复时钟；不改配方。恢复为渐进过程，`shell-restore` 表示壳已完整重新绘制，芯仍可处于渐进恢复。
- 成品显式传 `mode:'finished', waxCollection:false`，复用已确认的碎片掉落清理路径。没有新增收集盘玩法。三个蜡预设和三种内芯工厂、参数、几何安全检查均不变。

## C：真实事件合同 v1

这是 B 的实现合同，尚未收到 C 的确认，不能宣称已完成音频或真机视听验收。事件由场景 `onEvent` 提供；渲染模块不加载、合成或播放音频。一个场景实例只有一份观察器，销毁后停止通知。

公共字段：`version:1, sequence, type, recipeKey, styleId, feelId, shellMaterial, waxThickness`。sequence 在底层场景实例内单调，造型/质感重建会更换实例；音频归属仍以 A 所持实例生命周期管理。

| type | 触发依据 | 额外字段 |
| --- | --- | --- |
| `scene-ready` | 当前配置至少一次真实 `renderer.render` 成功 | 配方身份 |
| `shell-crack` | 蜡 `cracked` 或指甲油 `damagedVertices` 相比上一帧增加，壳已同步绘制 | `count`, `measure` 明确单位 |
| `shell-fracture` | 实际 `detached` 增加 | `count`，指甲油不虚构掉落 |
| `core-deform` | 真实当前顶点相对上一帧距原始位置增加 | `displacement`, `speed` |
| `core-recover` | 真实顶点距原始位置减少 | 同上；不是松手定时音 |
| `core-motion-end` | 实测运动停止或内芯求解器已无后续帧 | 无新裂/挤压来源 |
| `shell-restore` | 显式恢复后完整壳首次重新绘制 | 不代表自动回弹会长回蜡壳 |

运动/裂纹事件含 `time`（rAF 单调时钟，秒）、`elapsed`（实际帧间隔，秒）、`active`、`restoring`。`displacement` 是该帧顶点到原始位置的距离变化最大值（模型单位），`speed=displacement/elapsed`。这是几何活动强度，不是压力传感器、能量或物理功；滑动可能同时产生局部按入和局部恢复，C 应结合 `active/restoring` 决定声音。显式恢复与自然回弹通过 `restoring` 区分。

蜡 `exposure` 为真实已脱落分区数/总分区数，`exposureScope:'global-detached-panel-fraction'`；分区面积不同，**不是面积比例，也不是当前手指位置的局部露芯判定**。指甲油为 `null`，不以损伤顶点数伪装真实露芯面积。若 C 需要精确局部暴露/接触点归属，应另行对齐最小查询接口；本合同不授权用全局比例冒充手指正压到露芯。当前内芯没有独立可见断裂实现，因此不发明 `core-crack`。不按键盘/鼠标按住时长产生芯形变或裂声。

壳裂/碎裂事件先于同帧芯活动事件。定时驻留仍由已确认蜡皮自身实现，只有实际损伤/脱落增加才通知；静止顶点不持续产生挤压事件。棉花糖松手冻结时不虚构恢复事件。消费端异常隔离，不使渲染循环中断。

## 验证入口与限制

独立验证夹具 `tests/fixtures/finished-scene.html` 使用以上真实接口、正式 GLB、正式预设和正式构建包，不改生产页面布局。直接访问可复测，例如：

`/tests/fixtures/finished-scene.html?style=donut&core=butter&thickness=thick`

测试：`node --test tests/finished-scene.test.cjs tests/finished-scene-browser.test.cjs`。浏览器测试默认 63 蜡组合 × 桌面/模拟触屏，包含 GPU 实际上传、短按/长按、真实 GLB 曲率部位、拖动、重复按压、恢复、同配方重开、资源数量与销毁事件停止、取消/竞态/失败。`FINISHED_CASES=orb:clay:thin`、`FINISHED_DEVICES=desktop` 可选择复现，完整验收不得以子集代替。

正常 DPR=1，固定桌面 1280×900、模拟触屏 390×844。记录实时帧间隔（包含长帧；不把 >250ms 样本删掉），在昂贵的 exhaustive 几何检查前停止采样，避免将测试检查开销混入交互帧统计。视频另设 `FINISHED_EVIDENCE=1`，需 Playwright FFmpeg；将工具缓存放项目 `.tmp/playwright` 并设 `PLAYWRIGHT_BROWSERS_PATH`。每例 JSON 报告保留完整几何检查；正常速度录像覆盖圆球与甜甜圈代表组合。

手机模拟不是 iPhone/Android 真机，Safari、真机性能与视听盲听均未测。曲率检查只覆盖实际命中的指定区域和拖动路径，不能推断任意长时间操作、所有颜色与所有视角均通过。性能长帧或几何失败在矩阵单独保留，不降低现有检查或参数。

## 共享文件与回滚

唯一手改共享渲染文件为 `src/orb-preview.js`：增加可选真实事件观察器、渲染就绪通知与成品模式猫爪防护。其余新增模块与测试由 B 独占；`assets/orb-preview.js` 为该源码重新构建的产物。集成者先顺序合并本 PR，再由 A 接入页面提供者；不替 A 修改其 PR/Issue。

回滚 B 对应提交并运行 `npm run build:orb` 即恢复旧共享宿主；A 若已接入应同时撤销提供者导入。没有数据/作品存储迁移。本 PR 仅关联 #3/#38/#41/#43/#53，不关闭这些 Issue，不自行合并。
