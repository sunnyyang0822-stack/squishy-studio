# 大厅包装源文件（Issue #37）

大厅中每款捏捏以「捏捏＋透明 OPP/PP 硬质袋＋右上角 PVC 名牌＋小钢珠链＋少量微小贴纸」的独立物件展示。网页端用一个 WebGL 上下文把每个包装**只渲染一次**到各自的画布后释放，没有动画循环；所有重计算都在构建期完成。

## 组成

- `spec.json`：共享包装规范。袋体尺寸、玩具占比（最长边 = 袋宽 × `toyFill`）、硬片支点间距、折痕、袋边折点、吊牌形状与锚点、钢珠链、贴纸、相机与取景。各款只覆盖陈列色、封口纹样、贴纸、吊牌形状、随机种子、朝向和摆放角度。
- `src/hall-packaging/geometry.mjs`（构建期）：读取已确认 GLB（不修改模型），生成两层袋体。底层平放；上层是有厚度的硬片，由袋边与玩具顶部稀疏支点的上凸包构成，只在少数点接触玩具。另有尖脊折痕、按膜面消耗长度生成的袋边折点、翘角、真实穿孔绕边的钢珠链与卡扣、平放的吊牌、只贴在平整膜面的贴纸，以及防穿模审计。
- `src/hall-packaging/shared.mjs`：构建期与运行时共用的布局、袋边形变、吊牌外形。
- `src/hall-packaging/runtime.mjs`（运行时）：材质、灯光与一次性渲染、名称定位与字号适配。打包为 `assets/hall-packaging.js`。
- `src/hall-packaging/textures.mjs`：封口印刷、压纹、折痕法线、贴纸与吊牌印刷面，全部由代码绘制，不使用参考照片中的品牌、文字或贴纸。
- 名称字体：`assets/fonts/squishy-tag-rounded-bold.woff2`，由 `scripts/build-hall-tag-font.py` 从 Resource Han Rounded CN Bold（SIL OFL 1.1）按样式名截取并改名，授权见 `assets/RESOURCE-HAN-ROUNDED-LICENSE.txt`。

## 复现

```bash
npm ci
npm run bake:hall            # 全部款式；或 node scripts/build-hall-packaging.mjs cloud star
npm run build                # 含 build:hall，生成运行时脚本
```

烘焙只用 CPU，每款约 1 秒，输出 `assets/hall-packaging/<id>.glb`（meshopt 压缩，约 75–85KB）与 `manifest.json`（体积、三角形数、接触比例、间隙审计）。

## 质量闸门

构建时逐项审计间隙，任何一项为正即构建失败：玩具与上层膜、玩具与底层膜、贴纸穿入与悬空、钢珠链（珠与连杆对封口、吊牌、膜面）、自封条。名称由页面真实文字放在吊牌印刷区，字号按印刷区自适应，小于 10px 会被标记为不合格。

## 陈列配色

陈列色取自已确认的十色色卡，封口、贴纸与吊牌墨色由主体色按统一亮度和彩度上限推导。此配色**待产品评审**，只用于大厅展示，不改变制作配方或质感预设。
