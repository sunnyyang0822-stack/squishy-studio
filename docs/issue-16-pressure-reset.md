# Issue #16：渐进阻力、深压与换色重置

## 范围、原因与基线

2026-10-21继续修订阶段1B。用户指出中间像有实体球顶住、轻触过易下陷，并要求换色恢复最初状态。从明确的`origin/main` `b8117219a54b5199e190db7ddc7bcc773d669147`新建`codex/issue-16-pressure-reset`，不改首页、色卡布局、模型、依赖或框架，不进入碎裂/声音。

旧实现每个顶点统一被0.30位移上限截住；反复捏压触及这个固定边界，就会出现明显“硬芯”感觉。GLB实际仍只有一个可见mesh。本次移除统一0.30硬截止，改为局部剩余空间越小、继续压缩越困难的软限制，并降低初始下陷速度。

## 实际形变规则

沿用每stroke连续球面采样与最大包络、0.66邻域、0.04采样间距、85%保留、取消保留旧痕、单点输入及背景拖动旋转。

```text
origin = 初始网格包围盒中心
radius[i] = length(rest[i] - origin)
direction[i] = normalize(rest[i] - origin)
L[i] = 0.92 * radius[i]
strength = 0.025 + 0.45 * min(max(heldSeconds - 0.12, 0) / 2.4, 1)
                 + 0.04 * min(dragDistance / 0.5, 1)
target[i] = retained[i] + (L[i]-retained[i])
                          * (1-exp(-strength*envelope[i]/L[i]))
position[i] = rest[i] - direction[i]*offset[i]
```

- 轻触有浅反馈，按住约2.52秒后时长贡献达到上限；不读取真实压力。阻力是明确的时长/位移视觉映射。
- 单调响应`1-exp(-rate*dt)`：按住rate=7（前版24），释放rate=10，减少动态rate=16。轻触不再迅速塌入，继续按住可以越过原0.30深度；反复按压仍能逐渐深入。
- 软限制每次按剩余空间逐步收紧，不在0.30处硬停。逐顶点保留至少原半径8%作防越中心的几何边界；没有增加可见内球。径向位移保持正半径，防止深压时法线方向位移交叉或翻面。
- 松开仍保留本次新增位移85%，无振荡或额外外鼓。单步追赶≤64ms、误差≤0.00002精确收敛，稳定后停帧。不是体积守恒或真实材料力学；持续深压可以形成明显凹面或轮廓变化。

## 换色：先重新开始，再覆盖

选择不同颜色时，在同一场景中依次：结束捏压与旋转owner、释放捕获/按键状态；清空瞬态/永久压痕并立即拷回原始顶点；朝向恢复identity、接触阴影恢复初始位置；刷新碰撞包围球、矩阵与投影输入区，然后以既有顶部向下方式覆盖新颜色。

不整页reload、不重新下载GLB或新建renderer。旧指针move/up、键盘keyup不会再施加旧形变；下一次按压、旋转照常。快速换色仍从当前颜色接续，但球形始终重新开始。默认颜色首次加载直接正确显示；选中同一radio未发生颜色更换，不额外重置。新页面/重试原有清理逻辑保持。

模块：`src/orb-deformation.mjs`负责软限制/响应/重置；`src/orb-input.js`与`src/orb-rotation.js`新增取消接口；`src/orb-preview.js`协调reset、碰撞与换色；`src/orb-color.mjs`本轮无修改。

## 验证和证据

本机Windows10.0.26200 x64、Node24.21.0、Edge155.0.4283.62、Intel UHD/ANGLE D3D11。手机为Chromium/CDP模拟，无物理手机验证。

- `npm test`：**61/61通过，0失败、0跳过，退出0**，含构建；[完整日志](../artifacts/issue-16-pressure-reset/tests.txt)。保留已有首页/合集/加载失败/重试/不可用/手势/旋转/颜色覆盖回归。
- Kernel 8项包括100ms<0.025、3s>0.30、30次渐进深压、85%逐顶点单调保留、连续路径/稀疏输入、cancel/立即reset、六方向30次真实GLB indices每三角朝外、顶点径向未越中心且≥原半径8%。
- 三文件浏览器14项实际GPU验证：轻触比长按浅、长按突破0.30、重复继续深入、左右上局部命中与整路径留痕；换色后positions与GLB rest一致、矩阵与初始一致；GLB请求/context数未增加。键盘/鼠标捏压/旋转中换色均取消owner，旧事件不能复活，之后可再次操作；快切/reduce/停帧保留。
- `node capture-orb-interaction.cjs`：退出0、0 pageerror，10组尺寸/昼夜、两段实际操作录屏；[环境/位移记录](../artifacts/issue-16-pressure-reset/validation.json)。桌面记录轻触约0.01376、持续3秒约0.36936模型单位，换色后位移0且矩阵精确回到初始。未以这些数值虚构帧率。
- [桌面鼠标录屏24.20秒](../artifacts/issue-16-pressure-reset/desktop-interaction.webm)、[手机模拟触摸录屏19.44秒](../artifacts/issue-16-pressure-reset/mobile-touch-interaction.webm)，是真实输入过程，非静态拼帧；已查看实际视频帧。
- [长按深压](../artifacts/issue-16-pressure-reset/desktop-day-pressed.png)、[带痕旋转](../artifacts/issue-16-pressure-reset/desktop-retained-rotated.png)、[换色重置后覆盖中](../artifacts/issue-16-pressure-reset/desktop-color-start.png)、[换色完成](../artifacts/issue-16-pressure-reset/desktop-color-complete.png)。同目录覆盖1440×900、390×844、375×667、320×568、844×390的昼夜截图。

GLB仍124,324 bytes（121.4KiB）、2562顶点/5120三角形，Blender源与材质/灯光/十色无改动；静态包639,099 bytes（比前版增加397 bytes）。无新模型、贴图、音源、依赖或场景副本。所有图形/监听/动画清理继续由独立场景负责。

## 评审、限制与回滚

本轮继续停在阶段1B体验评审，不进入碎裂。待负责人实际确认阻力与持续深压手感；iOS Safari/Android Chrome真机的触控/滚动/方向/后台、发热/帧率/内存仍待验。深压为有界径向视觉塑形，不保证体积守恒或真实应力。进入碎裂前仍需壳芯/壳厚/破口/塑性与破裂关系/重置/碎片预算设计。

正常revert本轮PR合并提交并重建可回到`b811721`的前版：0.30上限、较快下陷、换色保留压痕。无数据迁移、不强推，Issue #16保持开启，仓库Private，原有临时目录和浏览器配置不提交。
