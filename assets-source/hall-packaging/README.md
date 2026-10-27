# 大厅包装源文件（Issue #37）

大厅中的每款捏捏以「饱满捏捏＋透明 PVC 袋＋右上角 PVC 名牌＋小钢珠链＋少量微小贴纸」的透明静态图展示。本目录与 `scripts/hall-packaging/` 一起构成可编辑源文件，运行时资产由脚本重新生成，不手工修改。

## 组成

- `spec.json`：共享包装规范。袋体尺寸、玩具占比（最长边 = 袋宽 × `toyFill`）、封口、贴附上限、吊牌、钢珠链、贴纸数量与尺寸、相机和采样数。各款只覆盖主体陈列色、上下封口纹样、贴纸种类、随机种子与朝向。
- `scripts/hall-packaging/studio.js`：Three.js 场景。读取已确认 GLB（不修改模型），生成袋膜（带空气鼓起的薄膜求解、少量贴附点、褶皱与压边折痕）、自封条、热压封口、吊牌、钢珠链与贴纸，再用 `three-gpu-pathtracer` 路径追踪。
- `scripts/hall-packaging/textures.js`：封口印刷、压纹、薄膜粗糙度、贴纸与吊牌印刷面，全部由代码绘制，不使用参考照片中的品牌、文字或贴纸。
- `scripts/build-hall-packaging.cjs`：构建入口。

## 透明背景

同一场景用完全相同的采样序列分别在黑底和白底上各渲染一次，在线性空间计算 `alpha = 1 − (白底 − 黑底)`，颜色取黑底结果除以 alpha 后再做色调映射。袋面透光部分得到真实的半透明 alpha，边缘不会出现白边、黑边或伪透明棋盘格。环境光只参与照明和反射，不作为可见背景。

## 名称

吊牌印刷面留空，样式名由页面中的真实文字叠放在 `manifest.json` 记录的印刷区四角坐标上，保持可访问、可读且与登记名一致。

## 陈列配色

陈列色取自已确认的十色色卡，封口与贴纸墨色由主体色按统一亮度和彩度上限推导。此配色**待产品评审**，只用于大厅渲染，不改变制作配方或质感预设。

## 复现

```bash
npm ci
node scripts/build-hall-packaging.cjs cloud star --views      # 指定款式，附带侧面与近景
node scripts/build-hall-packaging.cjs                         # 全部款式
node scripts/build-hall-packaging.cjs cloud --preview         # 光栅快速预览（不能显示透明薄膜）
```

可选参数：`--samples=N`（默认按 spec）、`--tiles=N`（每帧分块数，集成显卡遇到 Windows 2 秒驱动超时时调大）、`--out=dir`（评审图输出目录，默认 `artifacts/issue-37/renders`）。

输出：
- `assets/hall-packaging/<id>.webp`（1×）、`<id>@2x.webp`（2×）、`manifest.json`
- 评审图与统计：`artifacts/issue-37/renders/`

需要可用的 WebGL2 GPU。脚本优先使用本机 Edge，也可通过 `PLAYWRIGHT_BROWSER_PATH` 指定 Chromium。
