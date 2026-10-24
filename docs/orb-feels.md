# 可复用圆球质感

新增独立棉花糖：`getOrbFeel('marshmallow')` / `{ feelId: 'marshmallow' }`，工厂为 `src/orb-marshmallow.mjs`。单次局部按压从浅到深渐进（响应8/s、当前接触区2秒压力进程），离开的浅轨迹冻结，多次按压保留 .70 模型单位/至少24%安全半径的边界；释放和取消保留全部当前形态；只有用户显式恢复才复原。光学预设独立于形变，详见 [参数、测量、证据与接入](issue-26-marshmallow.md)。以下黏土参数与行为保持原样。当前登记以 `src/orb-feels.mjs` 为准。

已确认的内陷行为正式命名为 **黏土**，稳定调用标识为 **`clay`**。命名的是按压行为，不是光学材质或颜色。默认圆球与后续调用它的样式共享同一实现。2026-10-22 按用户要求整体提高交互阻尼，见 [当前阻尼与实测](issue-16-clay-damping.md)。

## 预制材质与跨样式调用

黏土和棉花糖都可直接通过统一预设调用；预设将手感、哑光光学工厂和默认外观组合起来，工厂内部仍独立：

```js
import { createOrbPreview } from '../src/orb-preview.js';
const preview = createOrbPreview(mount, { presetId: 'marshmallow', onUnavailable });
// 黏土用 presetId: 'clay'；慢回弹用 presetId: 'slow-rebound'。
// 保留 prepare / commit / dispose 协调，同质感仅换色不重建。
```

已有自定义网格场景可单独取得预制工厂：

```js
import { getOrbPreset } from '../src/orb-presets.mjs';
const preset = getOrbPreset('marshmallow');
const deformation = preset.createDeformation(positions, normals, { reducedMotion });
const material = preset.createMaterial(sourceMaterial);
// 每次调用都是独立实例；离页/切换时沿用现有生命周期并 material.dispose()。
```

注册表为 src/orb-presets.mjs 的不可变 orbPresets；稳定ID clay、marshmallow、slow-rebound。原 { feelId: 'marshmallow' } 仍兼容并取得同一光学工厂，显式feelId/appearanceId优先于preset默认值。shape/styleId不进入手感工厂，因此其他兼容样式无需复制场景即可调用。新版棉花糖足迹半径 .40（原 .66），滑动经过部分仅留下浅痕，停住后的持续加深只作用于当前接触区，历史轨迹逐顶点冻结；单点影响不到6%实际圆球顶点，足迹外顶点逐值不变；中心响应曲线、渐进过程和松手保持不变。

预设可复用不表示任意模型已验证：圆球沿原径向分支；本轮七款真实模型通过下述可选几何适配复用已确认工厂。其他比例或非凸模型仍应验证足迹尺度、命中和穿面。测试 tests/orb-presets.test.cjs 验证预设不可变、未知ID、工厂映射、独立形变和材质隔离。

## 新样式直接复用

沿用现有场景时：

```js
import { createOrbPreview } from '../src/orb-preview.js';
const preview = createOrbPreview(mount, { feelId: 'clay', onUnavailable });
// 继续使用现有 prepare / commit / dispose 生命周期，不新增循环或监听器。
```

在其他兼容模型的场景中，仅创建一个独立形变实例：

```js
import { getOrbFeel } from '../src/orb-feels.mjs';
const feel = getOrbFeel('clay'); // feel.name === '黏土'
const deformation = feel.createDeformation(positions, normals, { reducedMotion });
// 复用 orb-input.js / orb-rotation.js 和 orb-preview.js 的协调流程。
```

仅换颜色、材质、外观并复用黏土时保留 `feelId: 'clay'`。无需复制/重写捏压、路径采样、留痕、恢复或输入中断逻辑。制作流程棉花糖选项使用独立 `marshmallow`，慢回弹使用独立 `slow-rebound`；默认黏土不变。

## 黏土行为约定

- 同一套受控径向局部形变；单次路径取最大包络，稀疏事件补齐连续压痕。
- 轻触阻力、持续按住渐进深入、剩余空间软限制、85%新增压痕保留。
- 无过冲回弹；换色与形态/姿态恢复共用进度，支持快速换色及新输入接管。
- 正常/减少动态、取消/失焦/后台/离页、闲置停帧沿用现有实现。
- 形变公式见 [基础实现](issue-16-pressure-reset.md)，当前按压响应系数为5/s、滑动增压上限0.02，详见 [当前阻尼](issue-16-clay-damping.md)；白天颜色见 [色彩说明](issue-16-day-color.md)。未经用户要求不再调整参数。

## 新质感接入边界

登记处：`src/orb-feels.mjs`；黏土算法：`src/orb-deformation.mjs`；场景协调：`src/orb-preview.js`。登记项冻结、每次调用独立分配状态，未知 ID 明确报错，避免误用另一种质感。

新增质感只增加独立工厂和登记项，采用同一接口：`begin(point)`、`move(point, distance)`、`release()`、`cancel()`、`reset()`、`beginRestore()`、`applyRestore(progress)`、`interruptRestore()`、`setReducedMotion(value)`、`getState()`、`step(elapsed)`。`step` 返回 `{ changed, atRest, needsFrame }`。这样保留同一输入、生命周期及同步换色流程；不要修改已确认的黏土来冒充新质感，也不要复制整套场景。

网格需有可写 POSITION/NORMAL、均匀连续表面；黏土的局部半径/采样距离按当前模型单位设定，适合归一化、近圆/椭球的外表面。换外观可直接复用；全新凹形、多部件或比例悬殊的模型需先验证坐标、尺度与接触，不能仅靠名称保证任何网格都获得相同效果。光泽和昼夜灯光由场景负责，不是黏土算法的依赖。

## 非球形几何适配（Issue #30）

新七款支持 `clay`、`marshmallow` 和 `slow-rebound`。棉花糖明确复用 PR #32 的 `f9c223d87d52d603a721d726b54a0d5568c72956` 渐进局部按压版本；慢回弹复用 `aaaed2f19a5a2f3a34f4b9200d3189e2a9bed116` 主线已确认版本，参数见 `docs/issue-25-responsive-pressure.md`。统一调用 `createOrbPreview(mount, { styleId: 'donut', presetId: 'marshmallow' })`；黏土使用 `presetId: 'clay'`，慢回弹使用 `presetId: 'slow-rebound'` 并采用其默认 `full-matte` 外观。三者共用原 `prepare/commit/dispose` 生命周期。样式登记在 `src/squishy-styles.mjs`，与质感登记分开。

`src/surface-clay.mjs` 向同一个 `getOrbFeel('clay').createDeformation` 传入可选 `surfaceGeometry`：只提供每顶点几何方向、可压入半径、表面邻域和路径采样。工厂的 `.66` 足迹、`.04` 采样间距、按压强度、5/s 响应、85% 留痕、释放与恢复逻辑未调参；未传此选项的圆球继续执行原分支。等价球空间查询有逐帧相等回归，原圆球测试原样保留。

真实甜甜圈不能采用朝球心的方向或椭球补点，因此此可选几何契约必需。新适配沿真实网格图计算距离，不通过空孔补出球面路径。经每面有向体积验证的星形可参数化表面使用自身原始径向几何；猫爪、甜甜圈使用局部法线、内部厚度、曲率及三角形安全界限，界限只减不增地平滑。恢复始终回到各自原始网格。几何安全边界会影响薄处能压多深，不改变材料时序参数。

棉花糖同样接收可选 `surfaceGeometry`：方向与安全厚度来自真实几何，当前接触区及待处理路径都用真实表面邻域，避免甜甜圈跨孔相互按压。`.40` 足迹、`.04` 路径采样、8/s 响应、2 秒局部压力进程、`.06` 浅滑痕、40ms 单帧保护、停住后下一帧局部加深与旧轨逐值冻结均保留。猫爪的实际位移安全约束只缩减违规三角形关联的新增位移，未改变材料压力或卸载规则。几何安全厚度可能限制薄处最终深度。

`node scripts/check-marshmallow-baseline.cjs` 对固定 PR #32 head 验证正常/减少动态下原圆球逐帧位置、状态与返回值严格相等；七模型 CPU/GPU 用真实 GLB 检查渐进过程、局部驻留、保持与显式恢复，见 `tests/squishy-marshmallow*.test.cjs`。

慢回弹同样只新增可选几何方向、安全厚度、沿面路径及邻域查询，不修改 `slowReboundParameters`。`node scripts/check-slow-rebound-baseline.cjs` 对固定主线验证正常/减少动态、30/60/120Hz 共2622操作，参数对象及逐帧位置/状态/返回值严格相等。七模型对应 `tests/squishy-slow-rebound*.test.cjs`，检查局部渐进、浅滑痕、取消后继续恢复、自然精确回到各自原始模型，以及 `full-matte` 配方/相机/旋转/清理。薄处达到几何安全上限后继续驻留不会越过该边界。

猫爪采用三角形内部传播的一阶 Fast Marching 邻域，减少只沿网格边传播造成的压痕细褶；压力半径、模板时序与回弹参数不变。此近似保留钝角/非因果更新的单边回退，其他六款仍走原邻域及路径分支。局部实际位移安全投影保留原8%有向面积裕量，危险面只约束自身附近增量。细节、失败案例和证据见 `docs/issue-30-paw-revision.md`。

这套适配已针对本次资产验证，不承诺任意输入网格都兼容。详细数学前提、已发现的失败案例、视觉证据与有限验证范围见 [独立验证](issue-30-validation.md) 和 [交付说明](issue-30-clay-styles.md)。

## 独立慢回弹 `slow-rebound`

2026-10-23 走查反馈修订：120ms平滑起步、随后以pressSpeed .45模型单位/s匀速深入；长按限深提升至.46（径向安全限深50%），约0.82秒达到旧深度后可继续压深。拖动速度1.1、移动限深.20，停留.12秒后继续静止深压。原回弹.80/s、减少动态5/s、收敛.00001不变；不改灯光和外观。参数、速度曲线与证据见 [走查修订记录](issue-25-responsive-pressure.md)，下方保留原始交付历史。

工厂为 `src/orb-slow-rebound.mjs` 的 `createSlowReboundDeformation`，参数集中在同文件 `slowReboundParameters`。通过 `getOrbFeel('slow-rebound')` 或 `createOrbPreview(mount, { feelId: 'slow-rebound' })` 调用，统一接口不变，每次调用独立分配原始网格快照、压痕、当地接触时间与显式恢复状态。它缓慢压入、缓慢完整回弹，不保留黏土的永久压痕。

实际入口：`/squishy/cloud/` → 内芯材质 → **慢回弹**（配方稳定标识 `butter`）。复用制作页色卡与页面控制器，沿用同一场景、命中检测、输入、旋转、颜色、资源释放及哑光灯光。默认仍是黏土，棉花糖保留最新主线的独立 `marshmallow`。离开页面会销毁实例，再进入不携带旧形变。

开始时基线 `4f4ebfe` 中 #22 尚未合并；实施中发现 PR #24 已合并，已通过合并最新 `origin/main` `959a719` 接入正式流程，移除临时独立入口。`detail/state.mjs` 仅将 `butter` 的实际 `feelId` 映射为 `slow-rebound`，用户材质选择与行为 ID 继续分离。`detail/adapters.js` 在行为 ID 改变时通过现有 `dispose` 清理旧场景，再以新 `feelId` 创建独立实例；换颜色继续在同一实例中 `prepare/commit`，不需要重建。后续步骤与最终体验沿用所选内芯的实际手感。

等待CI期间 PR #28 合入棉花糖，已继续合并 `origin/main` `3154a07`。保留其 `src/orb-marshmallow.mjs`、`src/orb-optics.mjs` 及回归测试；`marshmallow` 映射和光学材质不被本预设覆盖。三种内芯现在各自独立登记。

最终检查期间 PR #29 又合入棉花糖加深修订，已合并 `origin/main` `1976819`，保留其全部参数、测试和证据；共享构建产物由两种独立工厂的最新源码重新生成。

自动回弹只在没有显式恢复时推进；`beginRestore/applyRestore` 交给现有换色时钟独占网格。`interruptRestore` 或新输入从当下形态接管，随后旧痕、新痕都继续自动恢复。取消结束施力但不瞬间清空形状。后台结束输入并暂停模拟，回到前台从当前网格继续；不会将后台墙钟时间作为一帧压入或回弹。减少动态效果保留缓慢按压，将释放恢复系数提高到5/s。

外观与行为独立：`src/orb-appearance.mjs` 的 `full-matte` 将模型展示缩放为 `[1, 1.06, 1.10]`，使高度和前后厚度更饱满；十种颜色的线性着色统一乘 `.94`，保持色相、色卡标识及哑光参数。制作页仅给 `butter` 组合 `{ feelId: 'slow-rebound', appearanceId: 'full-matte' }`；`clay`、棉花糖使用原样的 `matte`（缩放 `[1,1,1]`、着色增益1）。直接调用 `getOrbFeel` 不会隐式修改模型或颜色。场景外观变化同样重建独立实例，颜色变化不重建。

参数、几何量测、实际录屏、测试与回滚见 [Issue #25 交付记录](issue-25-slow-rebound.md)。这是适用于现有归一化圆球的受控视觉近似，不代表经过物性校准的真实记忆海绵。

## 验证与回滚

本节以下记录首次命名提交的验证与回滚；最新阻尼修订的77项测试、实际录屏及回滚见 [阻尼交付](issue-16-clay-damping.md)。

`node --test tests/orb-deformation.test.cjs`：原有13项真实 GLB 行为测试统一通过 `getOrbFeel('clay')` 调用，继续约束已确认的手感；另测稳定名称、未知ID、不可变登记及实例隔离。`npm test` 保留全部浏览器 GPU、输入、换色及页面回归。

本次从 `origin/main` `773c1dd` 建立 `codex/issue-16-clay-feel`。`npm test`（含构建）最终 **74/74 通过、0失败/跳过**，见 [日志](../artifacts/issue-16-clay/tests.txt)。首次73/74暴露合集跳转后立即读取 `isVisible()` 的时序问题，改为等待目标标题可见，不改页面逻辑，重跑全部通过。黏土算法文件 Git blob 与基线一致：`7483754663b65cad3a9b400477e155cc4345180e`；构建包 640,446 字节，增加195字节，无新增依赖或模型。

既有 [真实操作录屏](issue-16-pressure-reset.md) 和 [最新昼夜截图](issue-16-day-color.md) 仍对应当前手感/外观；本次只提取调用入口，没有新视觉效果或新录屏主张。新增模型仍需用现有走查覆盖真实命中、连续拖动、深压、换色恢复和手机操作。

回滚本次提交并重建即可恢复之前的直接调用，不涉及资产/数据迁移。关联 #16，交付阶段一；不进入碎裂/声音，Issue 保持开放。
