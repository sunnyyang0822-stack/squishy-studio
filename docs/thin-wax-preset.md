# 可复用薄蜡预设

稳定 ID 为 `thin-wax`，入口 `src/wax-presets.mjs`。它直接组合现有 `createThinWax`，`parameters` 与 `thinWaxParameters` 是同一只读对象，不复制场景、输入或手感算法。制作外壳／装饰步骤为当前八种造型的黏土 × 蜡 × 薄和棉花糖 × 蜡 × 薄调用同一预设：圆球、云朵、猫爪、圆柱、甜甜圈、三角锥、花朵、五角星。慢回弹及中／厚蜡不启用；所有棉花糖最终试捏保持原行为，不显示预览壳、不新增重开按钮。棉花糖的状态、几何与验证边界见 [专项说明](issue-38-orb-marshmallow-wax.md)。本合同仍不把任意外部模型视作自动验收通过。

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
  fullSurfaceSupport: false, // 默认；宿主对非圆球棉花糖显式传 true，见下文
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

`fullSurfaceSupport` 是可选几何约束，默认 `false`。当前制作场景在非圆球棉花糖上传入 `fullSurfaceSupport: feelId === 'marshmallow' && isSurface`；黏土及圆球沿原默认分支。该选项让附着壳以实际变形芯面支撑，并检查真实内／外顶点、面心、边中点及侧壁断面，避免新组合的浅滑和深压中漏检边／断面。工厂只透传参数，不检查 `feelId` 或选择内芯，不改变原棉花糖的阻力、渐进过程、轨迹冻结、松手留痕或恢复。将预设接到其他宿主时，几何适配选项由宿主的实际模型验收决定，不能把 `true` 当作所有模型已经合格的标记。

`begin` / `move` 接受模型局部坐标的 `[x, y, z]` 或 `THREE.Vector3`；`clock`、`step(dt)` 均使用秒，时钟应单调递增。松开、取消、命中丢失、失焦和后台必须调用 `end`（`release` / `cancel` 是同一结束接口）。持续滑动会由现有实现按局部接触位移重置驻留，不要另设累计长按计时。已经脱落的片可继续 `step`，直至 `needsFrame` 为假。颜色或配方改变时，宿主按当前配置重建并释放旧实例；同配方前后导航应保留实例和损伤。

默认关闭收集 `collectionEnabled: false`，不创建最终试捏流程。需要既有碎片收集行为的独立集成可显式传 `true`；对应收集容器、界面和验收由接入方负责。

同配方外壳／装饰往返保留损伤。所有棉花糖进入既有最终体验时继续旧内芯恢复，通过 `restore({preserveShell:true})` 保留暂时隐藏的制作壳；返回制作步骤须重新应用 `waxCollection:false` 展示属性而不修复破口。显式重新开始和实际提交的配方变化仍创建新状态；预览重开不扩展到棉花糖最终体验。

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

分块种子位于以原点为中心的单位球域，Voronoi 平面切分真实原始三角形，生成点通过重心坐标跟随原表面。附着层使用变形后的内芯支撑，碎片使用实时三角形 BVH 约束；分区之后按真实源三角面连通岛拆片，并用实际共享边建立邻接，避免跨孔绑定和远处同时开裂。若独立连通片超过 180 预算，确定性回退种子数量后重建；当前猫爪 173 片、甜甜圈 166 片，其余 180 片。高弯曲附着板保留表面支撑和裂边，不做会穿芯的整块铰链翘动；非凸面／侧壁依据实际最近芯面作局部校正，厚度仍为 0.014。这不等于分块拓扑适合所有非凸模型。偏心、非均匀缩放、开放网格、反向法线、不同模型尺度以及当前八款之外的非凸内圈／连接处均未因注册预设而获得验收。宿主应保持模型原点和尺度约定、外向法线、稳定索引及原始快照；不能把同一分区跨孔连接直接作为通用模型支持。

接入其他捏捏前，先独立验证局部命中、分区连通性、三角形覆盖与闭合断面；再以深压、拖动、恢复和旋转检查 `getMetrics({ exhaustive: true })` 的附着／碎片穿入、最小间隔与厚度误差，并保留正常速度视觉证据及目标手机帧时。必须分别回归原内芯质感行为、配置竞态与离页资源释放。验证完成前保留正式支持列表，不因工厂没有绑定 `styleId` / `feelId` 就启用新组合。

当前新七款棉花糖完整采样几何专项已有 7/7 通过记录，见 `artifacts/issue-38/all-marshmallow-full-support-geometry.txt`，不代表视觉或性能已经通过。猫爪的实际贴合和卡顿仍在诊断；其余黏土视觉已获用户确认，新棉花糖组合仍需提供走查链接给用户检查。保持阶段性 PR 未合并，只有用户查验确认且必需检查通过后才合并；GitHub 暂不可用时保留本地证据，不绕过该条件。真机及 Safari 尚未验收。

预设与收集盘回归：`node --test tests/wax-presets.test.cjs tests/wax-collection-tray.test.cjs`。覆盖默认下落清理／破洞保留、显式收集、实例隔离及收集盘实际体积和地面高度。现有几何、时序与碎片测试仍由 `tests/thin-wax.test.cjs` 负责。
