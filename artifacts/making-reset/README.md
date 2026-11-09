# 制作预览复原

基线：`origin/main` 的 `c140b5c`。关联制作流程 #22、外壳预览 #38。

- 内芯换色沿用原覆盖动画。切换内芯材质时，新场景准备好后，当前有捏痕或旋转的内芯先播放复原，再交给新材质。
- 试捏后进入外壳时，先在原画布中恢复裸芯的形状和姿态，再显示外壳；即使内外同色也适用。原状不额外等待。
- 外壳换色、换材质或蜡厚度时清除旧损伤并从当前内芯形态逐帧复原；实体壳换色使用同一恢复时钟过渡。换材质和厚度有短暂的淡入，减少动态效果下省略淡入并沿用原有短恢复时钟。
- 同配方外壳／装饰／最终试捏的损伤保留规则不变，所有手感和外壳物理参数保持原样。快速切换仍以最后一项为准。

## 证据

Windows Edge / Playwright，1440×900 CSS 像素，设备像素比 0.5。以下为真实浏览器截图：

- 内芯进入同色薄蜡外壳：[试捏后](01-core-dent.png) → [复原中](02-core-recovering.png) → [外壳显示](03-shell-after-recovery.png)。
- 指甲油外壳换色：[有旧损伤的粉色](04-polish-before-color.png) → [复原和换色中](05-polish-color-and-recovery.png) → [完整的绿色](06-polish-after-color.png)。

本地运行 `npm run build:orb`，再运行 `node --test tests/detail-state.test.cjs tests/detail.test.cjs tests/orb-color.test.cjs tests/orb-color-kernel.test.cjs tests/orb-deformation.test.cjs`：58/58 通过，退出 0。设置 `MAKING_RESET_CAPTURE_DIR=artifacts/making-reset` 可在该测试命令中复现截图。

风险：有捏痕的内芯切步时，外壳会在既有复原动画结束后显示；页面选项仍可操作并采用最后一次选择。无数据迁移；撤销本提交并重新构建即可回滚。
