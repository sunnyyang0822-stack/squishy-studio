# 可复用薄蜡预设

宿主应传入 `styleId`。猫爪与甜甜圈按用户要求选用small分块：260种子、连通片上限280，同时活动仍24；其他样式保持原180预算。`parameters` 仍表示基础薄蜡参数，small参数独立登记于 `smallThinWaxParameters`，不改变厚度、输入或内芯。当前大小及性能验证见 [追加说明](issue-38-small-shards-and-mm-paw.md)。

稳定 ID 为 `thin-wax`，入口 `src/wax-presets.mjs`。它直接组合现有 `createThinWax`，`parameters` 与 `thinWaxParameters` 是同一只读对象，不复制场景、输入或手感算法。制作外壳／装饰步骤为当前八种造型的黏土 × 蜡 × 薄、棉花糖 × 蜡 × 薄和慢回弹 × 蜡 × 薄调用同一预设：圆球、云朵、猫爪、圆柱、甜甜圈、三角锥、花朵、五角星。中／厚蜡不启用；棉花糖与慢回弹最终试捏保持原行为，不显示预览壳、不新增重开按钮。棉花糖的状态、几何与验证边界见 [专项说明](issue-38-orb-marshmallow-wax.md)。本合同仍不把任意外部模型视作自动验收通过。

```js
import { getWaxPreset } from './wax-presets.mjs';

const preset = getWaxPreset('thin-wax');
const wax = preset.create({
  geometry: core.geometry, // 有索引的可写 POSITION / NORMAL
  restPositions, restNormals, // 原始未变形 Float32Array，省略则复制创建时几何
  color: '#eed3af', // 壳色；内芯材质和颜色由调用者独立管理
  clock: () => performance.now() / 1000,
  worldMatrix: core.matrixWorld,
  collectionEnabled: false,
  fullSurfaceSupport: false, // 默认；宿主对非圆球棉花糖／慢回弹显式传 true，见下文
});
core.add(wax.group); // group 与内芯使用相同局部坐标及变换链

// 复用现有输入的一次命中，同时通知原内芯形变与薄蜡。
function begin(localPoint) { deformation.begin(localPoint); wax.begin(localPoint); }
function move(localPoint, distance) { deformation.move(localPoint, distance); wax.move(localPoint); }
function end() { deformation.release(); wax.end(); }

function frame(dtSeconds) {
  deformation.step(dtSeconds); // 先更新内芯 POSITION / NORMAL
  core.updateWorldMatrix(true, false);
  wax.setWorldMatrix(core.matrixWorld);
  const result = wax.step(dtSeconds);
  // 渲染更新与停帧沿用宿主场景现有机制。
  return result;
}
// 主动重新开始：按宿主恢复生命周期协调 deformation 与 wax.reset()。
// 离页或更换配置：wax.dispose()；由宿主释放自己的 core.geometry。
```

`getWaxPreset()` 默认返回薄蜡；未知 ID 抛出 `RangeError`。每次 `create` 独立分配壳几何、壳材质、损伤、时钟与碎片状态。调用者继续拥有内芯几何，薄蜡不修改内芯形变参数，也不创建事件监听器或 Pointer Capture。

`fullSurfaceSupport` 是可选几何约束，默认 `false`。当前制作场景在非圆球棉花糖／慢回弹上传入 `fullSurfaceSupport: ['marshmallow', 'slow-rebound'].includes(feelId) && isSurface`；黏土及圆球沿原默认分支。该选项让附着壳以实际变形芯面支撑，并检查真实内／外顶点、面心、边中点及侧壁断面，避免新组合的浅滑和深压中漏检边／断面。工厂只透传参数，不检查 `feelId` 或选择内芯，不改变原棉花糖的阻力、渐进过程、轨迹冻结、松手留痕或恢复。将预设接到其他宿主时，几何适配选项由宿主的实际模型验收决定，不能把 `true` 当作所有模型已经合格的标记。

`begin` / `move` 接受模型局部坐标的 `[x, y, z]` 或 `THREE.Vector3`；`clock`、`step(dt)` 均使用秒，时钟应单调递增。松开、取消、命中丢失、失焦和后台必须调用 `end`（`release` / `cancel` 是同一结束接口）。持续滑动会由现有实现按局部接触位移重置驻留，不要另设累计长按计时。已经脱落的片可继续 `step`，直至 `needsFrame` 为假。颜色或配方改变时，宿主按当前配置重建并释放旧实例；同配方前后导航应保留实例和损伤。

默认关闭收集 `collectionEnabled: false`，不创建最终试捏流程。需要既有碎片收集行为的独立集成可显式传 `true`；对应收集容器、界面和验收由接入方负责。

同配方外壳／装饰往返保留损伤。棉花糖与慢回弹进入既有最终体验时继续旧内芯恢复，通过 `restore({preserveShell:true})` 保留暂时隐藏的制作壳；返回制作步骤须重新应用 `waxCollection:false` 展示属性而不修复破口。显式重新开始和实际提交的配方变化仍创建新状态；预览重开不扩展到棉花糖最终体验。

## 公共性能方案

猫爪后续优化记录于 [查询与上传修订](issue-38-paw-query-upload-performance.md)。公共模块按源顶点版本复用映射，按实际改动片上传 position/normal，保留尚未被渲染器消费的更新范围并限制重复范围数量；失效片只清零一次。原完整碰撞样本及 0.014 厚度不减少。`fastPicking:true` 可复用碰撞树执行原三角形精确拾取，宿主仍须使用原事件、局部坐标及实际命中丢失结束规则；目前仅慢回弹猫爪显式启用，默认关闭。其 `createSurfaceGeometry(...,{fastNearest:true})` 同样只用于慢回弹猫爪，复用原静态树筛选最近顶点，保留原距离运算和最低顶点索引平局规则，不修改手感工厂。不能把这些查询优化视为其他模型已验收。

猫爪／甜甜圈的慢回弹制作预览修订候选新增 `compactPanels:true`，切分平面按真实曲面采样点的欧氏距离生成，避免球心锥在管面上切出长条；默认片总量和厚度不变。此分支自动使用 `relativeSupport` 的局部平移安全证书，仍逐个检查原完整体积样本；`relativeSupport:false` 可用于参考验证。其他组合保持原默认分块，不将候选自动扩展至黏土或棉花糖。数学界限、真实最长片尺寸、旋转下落及性能限制见 [两款修订说明](issue-38-compact-paw-donut.md)。

以下优化已在公共薄蜡模块内实现，调用 `getWaxPreset('thin-wax').create(...)` 自动复用。非圆球棉花糖／慢回弹仍须由宿主显式传入 `fullSurfaceSupport:true`；优化不授权新增模型组合，也不改变已有内芯工厂、壳厚、裂纹密度、掉片时钟和碰撞采样数量。

| 环节 | 复用规则 | 必须重新计算的情况 |
| --- | --- | --- |
| 附着蜡片输出 | 源顶点位置、法线及全部损伤输入相同，整片内外壳包围盒与变化芯三角形的前后联合包围盒不相交 | 源面变化、裂边变化、开裂／松动／翘起变化，或其他芯面接近、跨越当前壳体 |
| 裂纹失效范围 | 按每片真实裂边 mask 的变化记录版本，其他位置开裂不使本片失效 | 共享裂边打开或关闭；重开清空所有片缓存 |
| 特征法线 | 边法线及角加权顶点法线只在实际查询时生成，同一几何版本复用 | 芯几何 refit 后按原完整求和顺序重新生成；不做近似法线或增量累减 |
| 同距离最近面 | 局部网格内按实时 BVH 子节点距离与原叶片顺序选择同一面 | 大范围、越界或不适用的查询继续完整 BVH；不以球心径向判断非凸内圈 |
| 内芯几何厚度射线 | 相同标量算术代替三角形循环内的临时数组 | 安全厚度、容差及原三角形数据均不更改，原算法保留作逐值对照 |

仍逐一约束真实内外顶点、面心、唯一边中点与断面；缓存有安全证明才复用，碎片仍逐帧受实时芯面约束。不能以降低碰撞采样、跳过恢复阶段、关闭深度测试或改成透明遮盖来提速。源码位置为 `thin-wax-panels.mjs`、`thin-wax.mjs`、`thin-wax-feature-normals.mjs`；静态厚度射线属于共享几何适配器 `surface-clay.mjs`。

复用到其他模型后，先运行 `tests/wax-cloud-reuse.test.cjs` 所示的关闭缓存／完整法线对照方法，比较实际 Float32 壳坐标、法线及损伤逐帧严格相等；再做该模型的完整体积测量、自然恢复和资源生命周期验证。`cacheAttachedPanels:false`、`supportCertificates:false` 以及碰撞树的 `queryCache:false`、`lazyFeatureNormals:false`、`exactGridTies:false` 仅用于测试参考分支，不作为产品新增控件。

性能独立采集，勿同时录屏或运行本任务测试。`scripts/benchmark-wax-interaction.cjs` 测真实按压／滑动／恢复渲染间隔并核对服务包哈希；`scripts/benchmark-wax-kernel-paired.cjs` 交替执行旧／新算法，对相同输入测 CPU 耗时并断言壳输出相等。保留全部样本及 P95／最大值，桌面触屏模拟不代表手机真机。实际结果、失败尝试及当前限制见 [云朵优化说明](issue-38-slow-styles-and-cloud-performance.md)。

## 收集盘交接

`src/wax-collection-tray.mjs` 保留独立的 `createWaxCollectionTray()` 和只读 `waxCollectionTrayStyle`，供负责后续场景的 Agent 直接导入。工厂默认 `visible: false`，不自动挂入任何 scene，也不创建输入、计时器或物理系统。收集盘与薄蜡物理模块分开；显式开启 `collectionEnabled: true` 不会自动显示盘。

```js
import { createWaxCollectionTray, waxCollectionTrayStyle as style } from './wax-collection-tray.mjs';
const tray = createWaxCollectionTray();
scene.add(tray); // 世界坐标，不作为可旋转内芯的子节点
tray.visible = true;
// 保留原正交相机投影适配公式；camera.right 使用宿主当前投影范围。
const scale = Math.min(1.24, camera.right * .97 / 1.42);
tray.scale.x = scale; // 只延长 X；Y/Z 保持 1
tray.material.color.setHex(night ? style.nightColor : style.dayColor);
// 离页：tray.removeFromParent(); tray.geometry.dispose(); tray.material.dispose();
```

保留参数：视觉半径 1.42、物理收集半径 1.35、高 0.045、64 段，顶面位于世界 `floorY = -1.35`；昼色 `0xf2e6de`、夜色 `0x514754`、粗糙度 0.96、接收阴影。以上投影公式只缩放 X，不改变 Z 半径或顶面高度；其他场景调整视觉尺度时必须另行核对物理半径、世界地面和相机。调用方负责 scene 放置、昼夜切换、显示条件与 geometry/material 释放。默认不收集时，碎片下落后清理且破洞保留，不产生落地堆积或支撑网格。

## 几何与单位边界

厚度为 **0.014 模型单位**，安全间隔 **0.004 模型单位**，测量容差 **0.00001 模型单位**。当前圆球约为半径 0.9 的归一化模型；这些值不是米或毫米，不应直接用于任意尺寸资产，也不制作中／厚预设。其余参数以 `preset.parameters` 为准，包括当前驻留时序和碎片预算；接入者不要拷贝数值或局部重调已确认效果。

分块种子位于以原点为中心的单位球域，Voronoi 平面切分真实原始三角形，生成点通过重心坐标跟随原表面。附着层使用变形后的内芯支撑，碎片使用实时三角形 BVH 约束；分区之后按真实源三角面连通岛拆片，并用实际共享边建立邻接，避免跨孔绑定和远处同时开裂。若独立连通片超过该样式预算，确定性回退种子数量后重建；当前 small 猫爪 278 片、甜甜圈 271 片，其余 180 片。高弯曲附着板保留表面支撑和裂边，不做会穿芯的整块铰链翘动；非凸面／侧壁依据实际最近芯面作局部校正，厚度仍为 0.014。这不等于分块拓扑适合所有非凸模型。偏心、非均匀缩放、开放网格、反向法线、不同模型尺度以及当前八款之外的非凸内圈／连接处均未因注册预设而获得验收。宿主应保持模型原点和尺度约定、外向法线、稳定索引及原始快照；不能把同一分区跨孔连接直接作为通用模型支持。

接入其他捏捏前，先独立验证局部命中、分区连通性、三角形覆盖与闭合断面；再以深压、拖动、恢复和旋转检查 `getMetrics({ exhaustive: true })` 的附着／碎片穿入、最小间隔与厚度误差，并保留正常速度视觉证据及目标手机帧时。必须分别回归原内芯质感行为、配置竞态与离页资源释放。验证完成前保留正式支持列表，不因工厂没有绑定 `styleId` / `feelId` 就启用新组合。

黏土及棉花糖八款已获用户视觉批准，分别在 PR #42、#39 合并；慢回弹圆球在 PR #45 合并。其余七款慢回弹已接入制作预览，仍需用户查验后才合并。当前性能及验证范围见 [慢回弹扩展与云朵性能](issue-38-slow-styles-and-cloud-performance.md)。真机及 Safari 尚未验收。

预设与收集盘回归：`node --test tests/wax-presets.test.cjs tests/wax-collection-tray.test.cjs`。覆盖默认下落清理／破洞保留、显式收集、实例隔离及收集盘实际体积和地面高度。现有几何、时序与碎片测试仍由 `tests/thin-wax.test.cjs` 负责。
