# 指甲油脆皮：已确认预设

2026-11-05用户确认，稳定ID `polish-shell`，预设版本1。保存的是当前v10走查效果；用户已授权提交，按独立分支、验证和PR流程交付。场景仍是原单Canvas、原输入和三种已确认内芯。

## 直接复用

```js
import { getPolishPreset } from './polish-shell.mjs';
const preset = getPolishPreset('polish-shell');
const film = preset.create({
  geometry: core.geometry, restPositions, restNormals,
  color: shellHex, coreColor: coreHex, feelId,
  // 非圆球必须沿实际网格查询邻域和路径；圆球省略。
  ...(surfaceGeometry ? { surfaceGeometry } : {}),
});
core.add(film.group);
// 同一次命中：deformation.begin(point); film.begin(point);
// 拖动：deformation.move(point, distance); film.move(point);
// 结束：deformation.release()/cancel(); film.end();
// 每帧先推进内芯并更新法线，再film.step(dt)。复用宿主停帧时钟。
// 显式重开/换配方：film.reset()；离页/换实例：film.dispose()。
```

制作流程只需有效配方 `shellMaterial: 'polish'`，由现有 `previewFor` 和场景创建预设。内芯步骤裸芯；同配方正常切步骤保持损伤；换配方/主动重新开始重置；快速请求最后一个生效。禁止另设指针控件。

## 支持范围

`preset.supportedStyles`：orb/cloud/cylinder/donut/pyramid/flower/star；`preset.supportedFeels`：clay/marshmallow/slow-rebound。配方butter对应slow-rebound/full-matte。猫爪明确不支持，新增未知模型不能仅调用工厂就宣称已验证。

## 固定效果

- 干燥微光roughness .43、metalness0、环境贡献.65。保持现有色卡和昼夜灯光。
- 所有壳面始终贴当前内芯，gap .0035模型单位；非球折角独立约束壳面方向，内芯不改。零碎片/刚体/重力/收集盘。
- 大块主裂纹先出现，细裂纹从父裂纹邻域发展，交接线宽融合。真实discard裂口露当前芯面；持久damage、当前opening与慢回弹residual分别管理。
- 最终统一宽度增益1.5；棉花糖专属2.25再乘统一系数，轻压阈值.00008、满损深度.032；慢回弹自然恢复后专属增益1.5再乘统一系数，持久残余峰值位移16%且上限.07。具体算法以同一工厂为准，不复制公式到新场景。
- 只有实际芯壳颜色相同才启用描边，异色不描边。蜡厚度不应用于本预设。
- 芯面位置、normal和输入时钟由宿主拥有。每实例独立状态与资源，不覆盖内芯留痕/冻结/完整恢复行为。

## 验证与限制

工厂参数/预设不可变、实例隔离、实际遮罩、计次/采样密度、残余恢复和资源释放由 `tests/polish-shell.test.cjs` 约束。支持映射及流程见 `tests/polish-flow.test.cjs`。七款几何与浏览器证据见 [交付记录](issue-50-polish-shell.md)，含原始失败与修复日志。

已验证Windows Edge桌面及部分手机触屏模拟；未宣称手机真机或Safari通过。几何为离散样本验证，非连续时间相交证明。最新统一加粗只改裂口宽度，不重跑全部几何；既有11,345,376点非圆球支撑测量与原内芯逐帧对照见交付记录。当前效果未经用户明确要求不要继续调参。
