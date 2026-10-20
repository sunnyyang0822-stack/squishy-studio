# Issue #16：阶段 1A 圆球外观送审

状态：**等待产品负责人确认形态，尚未进入 1B。** 本 PR 关联 #16，交付阶段一中的 1A 外观部分；不关闭 #16，也不代表 #6 或 #10 全部验收。独立视觉审查结果为可送审，产品形态决定仍待负责人作出。

## 范围与入口

- 基线：`origin/main` = `0845e80ebcec3fefbf9e97a4020c5d8dd8559ca8`。
- 分支：`codex/issue-16-orb-appearance`。
- 沿用原生 HTML/CSS/JavaScript、锁定的 Three.js、esbuild 与 Node 静态服务。没有依赖升级或框架迁移。
- 在原有 `/squishy/cloud/` 详情页容器展示“奶油圆球”；保留这个已有 URL，合集入口文案对应改为“查看圆球外观预览”。保留原有设置布局与导航，首页代码/样式不改。
- 只展示一套基础外观。页面明确说明厚度、材质仅记录偏好；音量保持原静音适配器，没有音源或 AudioContext。没有捏压、回弹、裂纹、碎片或声音。
- 开始时存在的未跟踪 `.edge-tmp/`、`pelican-bike/` 保留，不纳入提交。

本地预览：`npm start`，访问 `/squishy/cloud/`。默认端口 4173；若被占用，PowerShell 可先设置 `$env:PORT='4190'`。当前捕获使用 `http://127.0.0.1:4190`。

## 资产与渲染边界

| 位置 | 职责 |
| --- | --- |
| `assets-source/squishy-orb/squishy-orb.blend` | 可编辑源；圆球、隐藏软芯参考、相机、参考灯光 |
| `assets-source/squishy-orb/export.py` | 选择当前场景中的外表面，重导 GLB，校验源文件条件 |
| `assets/models/squishy-orb.glb` | 一个不透明可见网格、一套标准 PBR 材质及顶点色 |
| `src/orb-preview.js` | 独立 Three.js 场景、GLTFLoader、相机、环境光、接触阴影、资源清理 |
| `scripts/build-orb.cjs` → `assets/orb-preview.js` | 使用现有 esbuild 输出可直接部署的独立 ESM 包 |
| `detail/adapters.js` | 延迟加载场景模块，包下载失败后使用新 URL 重试 |
| `detail/state.mjs` | 保留配置/音量状态、异步版本取消；增加上下文丢失状态入口 |
| `detail/page.js` | 将资源状态呈现给 UI，连接重试与生命周期 |

实际资产：GLB **124,324 字节（121.4 KiB）**，Blender 源约 937 KiB。外表面 **2,562 个顶点、5,120 个三角面**，闭合流形、无边界、无松散顶点；GLB 测试检查无重复位置的裂缝顶点。一个材质，metallic=0、roughness≈0.35，`COLOR_0` 奶油粉渐变，无 UV/贴图/骨骼/morph/动画/外部资源/必需扩展。模型 Blender 原点居中、变换为单位，Z-up 导出为 Y-up，包围尺寸约 **2 × 1.845 × 2**。这是归一化原型单位，不代表成品厘米尺寸。

源文件中的 `Soft_Core_REFERENCE_ONLY` 仅作内芯空间参考，隐藏且未导出。当前表面没有物理壳厚，不能据此声称脆皮结构已完成。后续碎裂必须重新定义实际壳/芯边界、开口与内表面。

静态服务器以仓库根为根目录，正确 URL 是 **`/assets/models/squishy-orb.glb`**，返回 `model/gltf-binary`。测试将响应与本地完整文件逐字节比较，并确认 `/models/squishy-orb.glb` 为 404，避免误用 Next 的 public 规则或 HTML fallback。部署须同时保留 `/assets`、`/detail`、`/squishy` 等当前根路径；尚未作公开部署验证。

场景不引用首页字标模块。配置变化复用同一个模型、canvas 和 WebGL 上下文；设置不改变颜色、比例或材质行为。静态预览没有持续动画循环；初次呈现、容器尺寸/主题/可见性变化时才请求帧。DPR 上限 1.75。离页/上下文丢失会取消帧、移除监听与 observer、释放几何/材质/纹理/环境并销毁上下文；重试重建场景。

接触阴影是前端生成的柔和静态纹理，不是物理阴影或壳体积。Blender 使用 EEVEE、AgX 和面积灯；浏览器使用 Three.js PBR、RoomEnvironment、方向/半球灯与 ACES。对照可验证同一轮廓与顶点色，但不能宣称光照和像素完全还原。夜间保持球体原色与照明，轮廓可读，底部阴影较弱。

## 视觉与过程证据

所有截图是实际浏览器/Blender 捕获。小屏和横屏使用整页截图，下方控件需要自然纵向滚动，不能把整页截图理解成所有内容均在首屏。

| 尺寸 | 白天 | 夜晚 |
| --- | --- | --- |
| 桌面 1440×900 | [截图](../artifacts/issue-16/desktop-day.png) | [截图](../artifacts/issue-16/desktop-night.png) |
| 手机模拟 390×844 | [截图](../artifacts/issue-16/mobile-day.png) | [截图](../artifacts/issue-16/mobile-night.png) |
| 紧凑模拟 375×667 | [截图](../artifacts/issue-16/compact-day.png) | [截图](../artifacts/issue-16/compact-night.png) |
| 小屏模拟 320×568 | [截图](../artifacts/issue-16/short-day.png) | [截图](../artifacts/issue-16/short-night.png) |
| 横屏模拟 844×390 | [截图](../artifacts/issue-16/landscape-day.png) | [截图](../artifacts/issue-16/landscape-night.png) |

- [Blender 与浏览器对照](../artifacts/issue-16/blender-browser-comparison.png)，以及 [Blender 原图](../artifacts/issue-16/blender-orb.png)、[浏览器局部](../artifacts/issue-16/browser-orb.png)。
- [加载失败](../artifacts/issue-16/load-failure.png)、[WebGL 不可用](../artifacts/issue-16/webgl-unavailable.png)。
- [实际外观预览操作录屏](../artifacts/issue-16/appearance-walkthrough.webm)：从合集进入、切换偏好、音量 UI、昼夜变化、真实模型请求失败与重试、返回合集。**仅证明预览流程，不是局部捏压/回弹录屏。**
- [设备与资源计时记录](../artifacts/issue-16/environment.json)、[本地测试原始输出](../artifacts/issue-16/tests.txt)、[Blender 独立重开导出输出](../artifacts/issue-16/blender-export.txt)。

独立视觉审查逐张查看尺寸/昼夜证据，未见模型裁切、横向溢出或控件遮挡。机械检测发现的详情页昼间辅助文字对比度和新说明字号已修复；七张相关新截图复验通过。只调整详情页辅助文字颜色/新说明12px，未改全局样式。既有焦点光晕保留，属于已有梦幻视觉。

## 本地验证结果

2026-10-20，Windows `10.0.26200 x64`，Node `24.21.0`，本机 Microsoft Edge（Playwright 报告 **155.0.4283.62**），Intel UHD Graphics / ANGLE D3D11。截图是桌面宿主与模拟手机视口，**没有真实手机验证**。

| 命令 | 真实结果 |
| --- | --- |
| `npm run build` | 退出 0；独立场景包与既有字标构建成功，未升级依赖 |
| `npm test` | 退出 0；36/36 测试通过，0 失败/跳过 |
| `node capture-orb.cjs` | 退出 0；10 张尺寸/昼夜截图、错误降级截图、对照、外观操作视频，0 pageerror |
| `blender --background assets-source/squishy-orb/squishy-orb.blend --python assets-source/squishy-orb/export.py` | 退出 0；独立重新打开源文件并重导 124,324 字节 GLB，无链接库 |
| `git diff --check` | 退出 0，无空白错误 |

新增测试验证二进制资产契约/法线/顶点色/预算/无外部依赖、真实 HTTP 响应、HTML 伪模型拒绝、模型和引擎包失败重试、真实 `WEBGL_lose_context` 后恢复、切配置不重建上下文或重复请求模型、尺寸/主题切换复用、空闲不持续渲染、离页释放及再次进入、模拟手机原生触屏事件可以从圆球区域滚动页面。原详情页测试更新为真实 canvas；原首页、合集、颜色与面板测试均保留通过。

后台状态测试是模拟 `document.hidden` 和 `visibilitychange`；不能替代真实手机锁屏/应用切换。现阶段圆球无操作手势，`touch-action:auto` 保留自然滚动；1B 的局部触控和指针中断恢复尚未实现或验收。

本次 localhost 模型资源条目耗时约 **2.3–4.5 ms**（Resource Timing，不包含完整 JS、GLB 解析、环境生成与首帧）。独立引擎包约 **612 KiB 未压缩**，复用已锁定 Three.js，静态服务当前未做传输压缩。每个捕获页面静态渲染计数 2，200ms 等待内未增长；测试另验证无空闲帧循环。**未测真机帧率、内存、长时间发热或弱网，不给出 FPS 达标结论。**

## 1B 方案比较与建议（待形态确认后实施）

| 方式 | 任意命中点与资产要求 | 成本和后续限制 |
| --- | --- | --- |
| Blender Shape Keys / morph targets | 对固定位置挤压可精修，但少量预设无法覆盖任意触点；需同拓扑并导出 morph 位移/法线 | 每个预设增加数据，混合及触点旋转难以稳定；适合预设演示，对未来裂纹定位帮助有限 |
| 受控 CPU 网格变形（建议首版） | 保留 rest positions，按实际 raycast 命中点对邻域施加连续衰减凹陷，更新法线；现有均匀闭合三角网格、无位置接缝适合该方法 | 2,562 顶点规模便于验证；活动时更新位置/法线有成本，须真机测量；能保持命中与渲染几何一致，后续仍需单独处理破损外壳 |
| 顶点着色器局部变形 | 无额外 morph 数据，GPU 更新便宜 | CPU raycast 仍看原网格，法线与未来阴影/碎片需额外同步；当前验证目标下增加复杂度 |

建议 1B 使用最小的受控 CPU 网格方案，按住时长/拖动位移映射强度，不读取真实压力。每次从静态基准重建位移以避免累计误差；触点连续平滑，松开由有阻尼的标量恢复控制。影响半径、深度、回弹时间都在形态确认后通过实际操作选择，当前不宣称已得到合适参数。

模块上保留 UI 状态/配置、渲染适配器和局部形变/单指输入边界；只在必要玩具区域协调手势，处理捕获释放、移出松开、pointercancel、失焦、后台、离页。手机端先用活动期间按需更新、限制DPR；若真机不足，再以降低法线更新频率或更低分辨率同形资产降级，须复验效果。减少动态偏好应缩短/简化恢复装饰，保留清晰反馈。以上均为下一步方案，未写入当前交互代码。

## 门槛、风险与回滚

当前阻塞合并/推进的是产品形态确认。请负责人确认轮廓、尺寸、默认角度、粉色层次、光泽和昼夜重量感；没有明确确认前不启动 1B。Draft PR 不自动合并、不自动关闭 #16。

1B 完成后仍需真实鼠标/单指的局部命中、按压拖动释放、中断恢复、反复操作/离页清理与触屏滚动录屏，补真机 Safari/Chrome、旋转/锁屏/后台、低端设备成本验证。现有静态截图不替代这些验收。

进入碎裂阶段前必须先通过形态与 1B 交互评审，决定实际壳厚与内芯拓扑、局部破损事件、不可逆外壳与可恢复软芯关系、重置规则和片数预算。当前不透明单表面无法直接表达破口内壁或芯体；不把偏好厚度当几何半径或 Three 光学 thickness，不把换色当材质行为完成。

回滚：合并后使用正常 `git revert` 撤销本 PR 的交付提交，重建静态包；详情页恢复原静态小云预览和入口文案。无需数据迁移；不强推、不改写共享历史。当前 Draft 可直接保留/关闭分支交付，远端 main 未被本轮更改。
