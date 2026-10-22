# 可复用圆球质感

新增独立棉花糖：`getOrbFeel('marshmallow')` / `{ feelId: 'marshmallow' }`，工厂为 `src/orb-marshmallow.mjs`。走查后加深至 .70 模型单位、保留至少24%安全半径；快速塑性塌陷，释放和取消保留全部当前形态；只有用户显式恢复才复原。光学预设独立于形变，详见 [参数、测量、证据与接入](issue-26-marshmallow.md)。以下黏土参数与行为保持原样。当前登记以 `src/orb-feels.mjs` 为准。

已确认的内陷行为正式命名为 **黏土**，稳定调用标识为 **`clay`**。命名的是按压行为，不是光学材质或颜色。默认圆球与后续调用它的样式共享同一实现。2026-10-22 按用户要求整体提高交互阻尼，见 [当前阻尼与实测](issue-16-clay-damping.md)。

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

仅换颜色、材质、外观并复用黏土时保留 `feelId: 'clay'`。无需复制/重写捏压、路径采样、留痕、恢复或输入中断逻辑。制作流程棉花糖选项使用独立 `marshmallow`；默认黏土不变。此远端基线未登记 `slow-rebound`，不从其他执行者未提交工作中移入实现。

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

## 验证与回滚

本节以下记录首次命名提交的验证与回滚；最新阻尼修订的77项测试、实际录屏及回滚见 [阻尼交付](issue-16-clay-damping.md)。

`node --test tests/orb-deformation.test.cjs`：原有13项真实 GLB 行为测试统一通过 `getOrbFeel('clay')` 调用，继续约束已确认的手感；另测稳定名称、未知ID、不可变登记及实例隔离。`npm test` 保留全部浏览器 GPU、输入、换色及页面回归。

本次从 `origin/main` `773c1dd` 建立 `codex/issue-16-clay-feel`。`npm test`（含构建）最终 **74/74 通过、0失败/跳过**，见 [日志](../artifacts/issue-16-clay/tests.txt)。首次73/74暴露合集跳转后立即读取 `isVisible()` 的时序问题，改为等待目标标题可见，不改页面逻辑，重跑全部通过。黏土算法文件 Git blob 与基线一致：`7483754663b65cad3a9b400477e155cc4345180e`；构建包 640,446 字节，增加195字节，无新增依赖或模型。

既有 [真实操作录屏](issue-16-pressure-reset.md) 和 [最新昼夜截图](issue-16-day-color.md) 仍对应当前手感/外观；本次只提取调用入口，没有新视觉效果或新录屏主张。新增模型仍需用现有走查覆盖真实命中、连续拖动、深压、换色恢复和手机操作。

回滚本次提交并重建即可恢复之前的直接调用，不涉及资产/数据迁移。关联 #16，交付阶段一；不进入碎裂/声音，Issue 保持开放。
