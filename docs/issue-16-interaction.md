# Issue #16：阶段 1B 局部捏压、留痕与旋转

> 本文保留上一版交付记录。2026-10-21 的扎实手感、连续路径与十色覆盖修订见 [最新说明](issue-16-solid.md)。

负责人已走查 1A 并授权开始 1B，随后要求不完全回弹，并确认“按住鼠标拖动留白才旋转”。本文记录当前行为；`artifacts/issue-16-1b/` 是此前完全回弹版本的历史证据，最新证据为 `artifacts/issue-16-plastic/`。本轮没有碎裂或声音。沿用明确的 `origin/main` 基线 `0845e80`、分支 `codex/issue-16-orb-appearance`、PR #17（关联 #16，交付阶段一，不关闭整个 Issue）。

## 当前行为

- 按住实际命中点产生局部凹陷，拖动平滑跟随；松开弹性恢复，保留本次相对既有形状位移约三分之一。旧凹痕可叠加，但总深度有上限。
- 按住鼠标左键拖动页面留白，绕球体真实包围盒中心旋转。水平一屏宽、垂直一屏高各对应一整圈，方向无限制，无惯性。普通悬停、捏球、导航和设置不触发旋转。
- 凹痕位于模型自身坐标，随球旋转；旋转后更新命中矩阵和投影输入区，仍可从新视角按压。页面重进、模型重试会清除留痕，不写入本地存储。
- 手机单指按球操作，额外触点不夺取当前操作；留白仍正常滚页，本轮不提供触屏留白旋转。只有球体投影椭圆使用 `touch-action:none`。
- 空格/回车按住球体，只有启动键释放结束按压；Escape取消。中断取消尚未释放的按压，恢复到之前已保留的形状，不清除旧痕。
- 页面已有厚度、材质、音量控件保留，只记录偏好；没有材质行为、真实壳厚、声音或试音。昼夜、缩放与配置复用场景，不重挂输入节点。

## 技术选择和资产契约

| 方案 | 任意局部按压 | 成本与限制 |
| --- | --- | --- |
| Blender shape keys / GLB morph | 固定触点可精修，少量预设不能覆盖任意触点 | 多方向组合增大资产及混合复杂度，难以任意留痕 |
| **受控 CPU 网格变形（采用）** | 实际 raycast 触点，连续邻域逐顶点位移 | 2,562 顶点，活动期间更新位置、重算法线；非体积守恒软体 |
| GPU 顶点着色器 | 可高效任意形变 | CPU 命中网格与视觉不同步，法线和未来碎片同步更复杂 |

Blender 源 `assets-source/squishy-orb/squishy-orb.blend` 与 GLB `assets/models/squishy-orb.glb` 不变。GLB 124,324 bytes（121.4 KiB），2,562 顶点/5,120 三角形，一套不透明标准 PBR + 顶点色，无贴图、morph、动画或必需扩展。网格连续无 seam，尺度半径约1，glTF Y-up；隐藏软芯仅为 Blender 结构参考，不导出。静态资源从仓库根提供，路径 `/assets/models/squishy-orb.glb`、MIME `model/gltf-binary`；无 public 路径转换。

| 文件 | 边界 |
| --- | --- |
| `src/orb-deformation.mjs` | 无 DOM/Three：rest 数据、每顶点位移/速度/保留值、邻域、强度与恢复 |
| `src/orb-input.js` | 单一 pointer/启动键 ownership、捕获、拖动、释放和中断 |
| `src/orb-rotation.js` | 鼠标留白拖动归属、控件排除、取消与清理；不接管触摸 |
| `src/orb-preview.js` | 独立 Three 场景、GLB、raycast、中心 pivot、GPU 更新、生命周期 |
| `detail/adapters.js` / `detail/state.mjs` / `detail/page.js` | 加载/失败/重试、配置状态和页面生命周期 |
| `tests/helpers/orb-probe.cjs` | 仅测试观察真实 GPU 顶点上传和绘制矩阵；无产品测试 API |

按下先 raycast 实际形变网格；拖动用未形变代理网格提供稳定锚点，避免锚点随凹陷向内漂移。代理矩阵随旋转同步。移出球体后保留最后有效锚点，捕获仍接收释放。旋转使用相机 up/right 轴四元数增量，避免欧拉角限制。中心来自原网格包围盒，初始外观不变；仅改变模型矩阵，凹痕顶点不因旋转重写。

## 可复现规则

```text
strength = min(0.34, 0.17 + 0.15 * min(holdSeconds / 0.8, 1)
                           + 0.06 * min(dragDistance / 0.5, 1))
dragDistance = 距按下点的屏幕位移 / 当前球体输入区域宽度
q = rest 顶点到平滑接触点的距离 / 0.66
weight = q < 1 ? (1-q²)² * (1-2.2*q²) : 0
activeTarget[i] = clamp(retained[i] + strength*weight, -0.02, 0.36)
onRelease: retained[i] = clamp(retained[i] + (offset[i]-retained[i])/3, -0.01, 0.22)
inactiveTarget[i] = retained[i]
position[i] = rest[i] - restNormal[i] * offset[i]
```

不读取设备压力。每顶点 spring mass=1、stiffness=100、damping=10；积分子步≤4ms，单帧追赶≤64ms。目标差≤0.0002且速度≤0.003时精确吸附，稳定后停止请求帧。位移始终从 rest 计算，保留值有界，未做无界累积。接触点按 `1-exp(-18*dt)` 跟随；新按压保留当前每顶点位移和速度，不跳回原形。小幅外鼓被限制，模型局部底部不低于 -0.905。

减少动态用 `1-exp(-30*dt)` 无振荡趋近目标；旋转始终直接响应拖动，无额外装饰运动。保留凹痕的法线重新计算，只有全零时恢复原始法线。`cancel()`丢弃未释放操作并恢复已保留形状，`reset()`才清空所有留痕。

## 生命周期

| 事件 | 行为 |
| --- | --- |
| pointerup（含区域外）/启动键keyup | 清 owner/捕获，保存三分之一新位移并回弹 |
| pointercancel/lost capture/失焦/后台/Escape | 清输入，丢弃未完成按压，保留旧痕；后台不请求帧 |
| 背景拖动的 up/cancel/lost capture/失焦/后台 | 终止旋转，无惯性；下一次拖动可用 |
| 第二触点/非启动键keyup | 不抢占，不提前结束当前操作 |
| 旋转/窗口缩放 | 更新矩阵与投影输入区域；复用 renderer 和按钮 |
| 离页/context lost/重试 | abort监听、断开observer、取消动画、释放GPU及代理；新实例从原形开始 |

接触阴影为柔和近似平面，无实时阴影图；旋转后按当前最低顶点调整阴影平面，防止穿入球体。没有体积守恒、应力、摩擦或真实塑性材料模拟。桌面/手机 DPR 上限1.75，活动时遍历网格并更新法线；暂无真机数据支持更激进降级。将来可降低 DPR/法线更新频率或提供同形低分辨率资产，不能据当前模拟结果宣称手机性能达标。

## 验证与证据

本机 Windows 10.0.26200 x64、Node 24.21.0、Edge 155.0.4283.62、Intel UHD / ANGLE D3D11。触摸来自 Chromium CDP 模拟，无物理手机。测试 probe 有额外观察开销，不作 FPS 基准。

- `npm test`：49/49通过，0失败、0跳过，退出0；[完整输出](../artifacts/issue-16-plastic/tests.txt)。保留首页、合集、详情控件、加载失败/重试/WebGL不可用等既有测试，补充真实 GPU 留痕、连续输入、中断与旋转验证。
- `node capture-orb-interaction.cjs`：退出0、0 pageerror；[运行记录](../artifacts/issue-16-plastic/validation.json)，10种尺寸/昼夜截图、真实鼠标和原生 CDP 触摸录屏，无静态拼帧。桌面视频17.80秒、手机模拟12.28秒，已查看实际视频帧；静态包635,169 bytes。
- [桌面操作录屏](../artifacts/issue-16-plastic/desktop-interaction.webm)：局部按压、拖动、部分恢复、异处留痕、整圈及四分之一圈旋转、昼夜切换后再按压。
- [手机模拟触摸录屏](../artifacts/issue-16-plastic/mobile-touch-interaction.webm)：单指局部按压、连续拖动、多处留痕、夜间取消后恢复到旧形状。
- 桌面：[白天留痕](../artifacts/issue-16-plastic/desktop-day-retained.png)、[夜晚留痕](../artifacts/issue-16-plastic/desktop-night-retained.png)、[旋转留痕](../artifacts/issue-16-plastic/desktop-retained-rotated.png)。
- 手机390px：[白天留痕](../artifacts/issue-16-plastic/mobile-day-retained.png)、[夜晚留痕](../artifacts/issue-16-plastic/mobile-night-retained.png)。同目录 compact（375×667）、short（320×568）、landscape（844×390）昼夜整页图；短屏设置自然纵向滚动。
- [1A Blender/浏览器外观与导出说明](issue-16-appearance.md)；其证据对应静态形态，不替代当前交互录屏。

后台/失焦用模拟生命周期事件，触屏取消用原生CDP输入，不能等同真机锁屏或切应用。真机待验：iOS Safari/Android Chrome 的触控命中、页面滚动、方向变化、切后台、触控延迟、发热、帧率与内存。当前不编造性能数字。

## 评审、后续与回滚

阶段1B当前行为等待负责人实际体验；没有进入碎裂阶段。进入碎裂前需确认留痕比例/上限与旋转体验、补真机验证，定义真正外壳/软芯拓扑、破口内壁、壳厚意义、触发去重、塑性外壳和软芯的关系、重置规则及碎片预算。当前单表面不能直接用作可碎裂壳体。

仅回滚此次留痕/旋转修订：正常 revert 对应第三个提交并重新构建，回到 `676581a` 的完全回弹版。回滚1B：再 revert `676581a`，回到 `3169fe2` 的已确认静态1A。回滚整个阶段一：revert PR #17合并提交。无数据迁移、不强推、不改写共享历史。仓库保持Private，原有`.edge-tmp/`、`pelican-bike/`和浏览器配置/临时录屏目录不提交。
