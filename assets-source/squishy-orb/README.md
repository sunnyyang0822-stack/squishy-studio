# 奶油圆球：阶段 1A 可编辑资产交接

本文记录 1A 的静态资产契约：奶油粉顶点渐变、饱满圆润轮廓、微压平底部、柔和高光与接触阴影。形态经负责人走查后进入 1B，当前同一 GLB 已接入局部捏压、部分回弹留痕及鼠标留白拖动旋转，详见 [1B 说明](../../docs/issue-16-interaction.md)。碎裂与声音尚未实现；页面的厚度、材质与音量目前只记录偏好。

## 源文件与导出契约

| 项目 | 当前值 |
| --- | --- |
| 可编辑源文件 | `assets-source/squishy-orb/squishy-orb.blend`，Blender 4.4.0 |
| 源场景 / 导出对象 | `Squishy_Orb_1A` / `Orb_Surface` |
| 表面拓扑 | 2,562 顶点、5,120 三角形；均匀连续网格，无拆分 seam 顶点 |
| 材质 | 单一不透明标准 PBR，roughness 0.35、metallic 0；`COLOR_0` 顶点色承载奶油粉渐变 |
| 依赖 | 无贴图、无外部链接库、无必需 glTF 扩展 |
| 运行时文件 | `assets/models/squishy-orb.glb`，124,324 bytes，一个可见 mesh |
| 坐标与尺度 | 场景单位缩放 1，原点位于中心；Blender Z-up 导出为 glTF Y-up；glTF 包围盒尺寸约 `(2, 1.845, 2)` |
| 来源 | 项目自制资产，无外部生成素材 |

`Soft_Core_REFERENCE_ONLY` 是源场景内隐藏的结构参考，只供后续设计讨论，不导出到 GLB。当前单表面并不代表已经实现实际壳厚、内芯物理结构或可碎裂壳体。

## 恢复与重新导出

在仓库根目录运行下列 PowerShell 命令；将可执行文件路径替换为本机 Blender 4.4 的位置：

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.4\blender.exe' --background 'assets-source/squishy-orb/squishy-orb.blend' --python 'assets-source/squishy-orb/export.py'
```

若 `blender` 已在 PATH 中，可直接使用 `blender --background assets-source/squishy-orb/squishy-orb.blend --python assets-source/squishy-orb/export.py`。也可在 Blender 打开源文件后执行该脚本。脚本从自身路径计算项目根目录，切到指定源场景，取消所有选择，仅选择 `Orb_Surface` 并按当前活动场景及选择导出；保留法线和顶点色，不导出 UV、动画、相机或灯光。重新导出会覆盖运行时 GLB，检查差异后再提交。

实际重开源文件并导出的日志见 `artifacts/issue-16/blender-export.txt`：Blender 4.4.0 成功读取 `.blend`、导出一个 primitive，日志中的顶点数、三角形数和 GLB 字节数与上表一致，外部链接库为 0、参考内芯为 source-only。日志中显示 Draco 库可用仅是环境提示，当前资产未要求 Draco 解码。

本地构建与验证：

```powershell
npm ci
npm run build
npm test
npm start
```

打开 `http://127.0.0.1:4173/squishy/cloud/`。`build:orb` 将 `src/orb-preview.js` 打包为 `assets/orb-preview.js`；Blender 导出独立执行。当前 `server.mjs` 从仓库根目录提供静态文件，因此模型 URL 是 `/assets/models/squishy-orb.glb`，不是 Next.js 的 `public` 目录约定。恢复资产时可从 Git 恢复这对 `.blend` / `.glb` 文件，或从已确认的源文件重新导出后验证。

## 与既有页面的衔接

本次按既有界面的局部扩展交接。首页 `index.html` 与详情 `squishy/cloud/index.html` 继续使用中文页面结构和共享 `styles.css`；共享的白天粉白至青色天空、夜间紫蓝天空、中文无衬线正文及 Fredoka 品牌字维持原有视觉语言。详情的 `detail/detail.css` 已以粉色／青色柔光背景、夜间紫色背景、圆润设置控件和展示区光晕承接该语言。

圆球通过 `detail/adapters.js` 装入既有展示挂载点，展示区仍沿用桌面最大 620px、手机断点 600px、设置区桌面两列／手机一列的规则。透明 WebGL 画布让既有昼夜背景与光晕继续可见；本交接不扩展为全站设计规范，也不处理全局视觉漂移。对比依据是上述 HTML/CSS 与当前加载路径，不应把资产局部选择提升为全站规则。

## 浏览器与 Blender 的外观边界

浏览器使用 Three.js `RoomEnvironment`、半球光与方向光、sRGB 输出及 ACES 色调映射（exposure 0.95）；Blender 参考图使用 EEVEE / AgX。两边灯光、环境与色彩处理不同，应比较轮廓、渐变、高光和落地感，不能声称像素一致。参考拼图见 `artifacts/issue-16/blender-browser-comparison.png`。

底部接触阴影由 `src/orb-preview.js` 在前端生成径向渐变贴图及平面，并非 GLB 自带的阴影或实时阴影图。阶段 1A 按需绘制，没有持续动画循环；后续形变、抬起或碎裂需要重新验证阴影与物体的接触关系。

## 验证证据与后续工作

`tests/orb-asset.test.cjs` 检查单网格标准 PBR、位置／法线／顶点色、三角形预算、无外部资源和无拆分 seam 顶点。现有记录 `artifacts/issue-16/tests.txt` 为 36 项测试通过；`environment.json` 记录桌面宿主的 headless 浏览器、Intel UHD / ANGLE D3D11、DPR 1，以及桌面、手机尺寸、短屏和横屏的昼夜检查，所记录场景无水平溢出且错误列表为空。手机尺寸是浏览器模拟，并非真机。

阶段 1B 已采用受控 CPU 网格形变验证按压与回弹，利用连续均匀拓扑维持表面闭合；没有建立材料力学、壳厚或碎裂模型。隐藏内芯仍仅作为源文件参考，源文件与 GLB 保持不变。真机触控、持续形变帧率、移动 GPU 预算、声音素材及听感、动态接触阴影、碎裂机制和实际壳厚均待后续验证；1A 静态按需绘制的加载时间和渲染次数不能当作动态 FPS 证据。
