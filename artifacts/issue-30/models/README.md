# Issue #30 七种黏土模型：几何交接

本批资产是项目原创 Blender 4.4 几何。所有新增样式仅复用 `clay`；没有改三种质感模板、原圆球、色卡或运行时灯光。浏览器效果和真实按压证据由浏览器交付记录单独证明，本目录的 Blender 图只证明造型和多视角厚度。

| ID | 顶点 | 三角形 | GLB bytes |
| --- | ---: | ---: | ---: |
| cloud | 7,136 | 14,268 | 258,188 |
| paw | 9,780 | 19,556 | 353,376 |
| cylinder | 6,424 | 12,844 | 232,560 |
| donut | 6,144 | 12,288 | 222,496 |
| pyramid | 4,100 | 8,196 | 148,916 |
| flower | 8,654 | 17,304 | 312,840 |
| star | 6,944 | 13,884 | 251,284 |

总 GLB 1,779,660 bytes。每模型为一个 `Squishy_Surface` mesh、一个 primitive、一个可替换 PBR 材质，POSITION/NORMAL 和闭合三角索引，无 UV seam、贴图、外部库、必需扩展或相交内壳。原点为包围盒中心；米制；Blender Z-up 导出 glTF Y-up；默认正面 glTF +Z。完整包围盒见各自 JSON。未通过无限细分代替圆滑：网格为 4,100–9,780 顶点。

最新产品评审修订：猫爪保留 **4 趾、4 个鼓起趾垫、1 个倒心形主肉垫**，尖端向上、下方双圆瓣，真实融合。云朵保留云瓣外轮廓，正背面改为连续凸起厚度曲面，消除原先球交汇的莫名凹点。三角锥 **三角底四面体** 已获产品确认，三个底角加一个顶部，所有棱和顶点圆钝；此次未修改它的 GLB。用户最新明确覆盖初始六瓣环规格：花朵现在是 **5 个圆球花瓣 + 1 个鼓起圆球花蕊，共 6 球**，由单材质几何体积区分花蕊，全部融合而无孔洞或内部壳。甜甜圈为真正环面，中孔为贯通拓扑。

甜甜圈最新评审加厚：主半径 0.72、管半径 0.44，外径 2.32、厚度 0.88，中孔直径 0.56 仍清晰贯通。环管比初稿加厚约 22%，顶点与三角形预算不增加，仅修改甜甜圈几何。

源文件：`assets-source/squishy-<id>/squishy-<id>.blend`。运行时：`assets/models/squishy-<id>.glb`。源目录的 `preview.png` 是斜前方预览；本目录 `<id>-front/side/back/bottom.png` 为正、侧、背、底视图，`review.png` 为多视角拼图，`review.html` 可逐一放大。

在独立后台 Blender 运行：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.4/blender.exe' --background --python scripts/build-styles.py
node artifacts/issue-30/models/capture-review.cjs
node --test tests/squishy-styles-assets.test.cjs
```

可在脚本参数 `--` 后指定一个或多个 ID，只重建这些资产。脚本会清空当前场景，因此只在后台新进程执行，不要用于用户未保存的交互场景。每个 `.blend` 含可编辑表面、当前独立预览相机及灯光；运行时仅导出所选择的表面。

实际验证：生成器断言每条边 manifold、无重复顶点并重算法线；最终资产测试 **8/8 通过**，包括登记路径和七个实际 GLB 的单连通闭合、有效法线、厚度和预算，见 `asset-tests.txt`。生成日志保留初次错误和后续成功重跑，不隐藏失败。`capture-review.cjs` 使用系统 Edge；不依赖另装的 Playwright Chromium。

这些网格不是物理体积仿真。手机性能、非球形局部形变及交互可玩性需看运行时测量，不能根据 GLB 体积或静态截图声称通过。回滚时成对还原各模型 `.blend`/`.glb` 和登记，再构建并运行全部回归；原圆球资产没有变动。
