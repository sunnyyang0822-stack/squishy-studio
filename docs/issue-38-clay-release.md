# 黏土薄蜡独立发布

本分支从 `origin/main` 的 `3acd470` 建立，普通合并已验收的黏土薄蜡基线 `1185cfc`，再单独移植猫爪精确查询优化。用户已确认其余黏土样式通过，并于本轮明确授权黏土猫爪优化版合并。棉花糖薄蜡仍在独立工作分支修复，本发布不启用它，也不修改既有棉花糖／慢回弹手感或默认中蜡。

正式范围保持八款黏土的 `wax × thin` 制作预览：圆球、云朵、猫爪、圆柱、甜甜圈、三角锥、花朵、五角星。场景和状态的薄蜡范围仍为 `feelId/coreMaterial === 'clay'`；本次未带入 `fullSurfaceSupport`、特征法线、棉花糖配方入口或棉花糖专项场景测试。壳芯独立、厚度 0.014、normal 间隔 0.004、0.5 秒驻留阈值、活动 24／总 180 片及导航保损伤规则均保持原交付。

性能改动包括保守有限线段裁剪、距离平方剪枝、4 面叶节点、同片共边去重、精确零位移查询省略、断面法线每条边只算一次，以及有界局部三角面索引和带证书的最近面复用。复用仅在查询位置／相关三角面未变，或最近面与次近面的距离间隔足以证明在累计核心运动范围内仍然有效时生效；距离和法线从当帧面重新计算。远查询、越界和等距面均使用完整实时 BVH。没有减少非零独立样点、厚度、壳片预算、阴影或内芯精度。

本地纯 Node 验证命令：

```text
node --test --test-concurrency=1 tests/wax-cache-surface.test.cjs tests/wax-collision-query.test.cjs tests/wax-collision-cache.test.cjs tests/wax-style-geometry.test.cjs tests/thin-wax.test.cjs tests/thin-wax-debris.test.cjs tests/wax-presets.test.cjs tests/wax-collection-tray.test.cjs tests/detail-state.test.cjs tests/orb-deformation.test.cjs tests/orb-marshmallow.test.cjs tests/orb-color-kernel.test.cjs
```

结果 **93/93 通过、退出码 0、94.34 秒**，见 `artifacts/issue-38/clay-release-unit-geometry.txt`。包含八款真实 GLB 面／边／断面防穿模、原圆球与碎片、黏土和既有棉花糖内芯回归、状态／资源，以及缓存开启／关闭时真实壳 Float32 位置和法线逐值一致的对照。公开 CI 和本分支真实浏览器验证另按实际结果登记；不使用其他运行包的通过记录代替本分支检查。

测试观察器仅在测试中于真实 core GPU 上传后结束短按，以避免软件渲染的 draw 阻塞把短点击拖成超过 0.5 秒；输入下压可信、Pointer Capture、非零形变、上传位置和实际耗时仍严格检查。长按断言读取首次驻留超过 0.5 秒的已完成渲染帧，阈值前所有采样仍必须零掉片，未修改时钟或产品输入。

性能数字属于 Windows Edge 桌面及触屏模拟，不等于手机真机验收。用户视觉确认与测试记录分开；其他外部模型、手机真机、Safari、慢回弹外壳及中／厚蜡不在本次发布验收范围。

## 本分支浏览器、性能和录像

本分支运行包 SHA-256 为 `efb4417fe1cb540598d1a38d4e3b8af32793e7af3aa906f7c24334cdb0041398`。真实浏览器命令为 `node --test --test-concurrency=1 tests/thin-wax-browser.test.cjs tests/wax-style-browser.test.cjs`，TEMP／TMP 在工作树 `.tmp/runtime`，独立测试端口为 4254／4255，使用宿主 Edge、默认 DPR1、不修改时钟或使用 CPU 限速。首次 20 项中 19 项通过，首个 orb 主交互因取消超时未完成（实际报告墙时 1017 秒、设定超时 90 秒）；原始输出保留在 `clay-release-browser.txt`，不将这次不完整运行伪称为 20/20 通过。同一主交互用完全相同断言重跑 `node --test --test-name-pattern='thin wax \+ clay: actual core geometry' tests/thin-wax-browser.test.cjs`，**1/1 通过、退出码0、16.51秒**，见 `clay-release-orb-main-retry.txt`。实际短按25.1ms，阈值前零掉片，首个超过阈值的已完成帧0.5083秒掉3片，真实GPU几何及全部穿入断言通过。两次运行合计覆盖全部20个不同浏览器案例。

性能单独在端口4345的本发布服务器测量，脚本先验证实际提供的 `/assets/orb-preview.js` 与本地运行包哈希相等，再运行 `scripts/benchmark-thin-wax.cjs`，不会误测另一个工作树的4380服务。环境为390×844桌面触屏模拟、Intel UHD／ANGLE D3D11、全新配方实际按住4秒，测量未与本任务的其他自动化重CPU／GPU工作并发，仍无法控制使用者的桌面负载。本次48个完整渲染间隔的中位数 **91.0ms**、P95 **106.1ms**、最大 **107.1ms**，全部间隔原样保留于 `clay-release-paw-performance.json`，命令退出码0。此前其他阶段曾出现更好数字，不用它们替代本分支这次结果，也不据此宣称手机流畅。

正常速度实际录像为 `clay-release-paw-desktop.webm` 与 `clay-release-paw-mobile.webm`，元数据见 `clay-release-paw-videos.json`，两例完成、页面错误为空、附着／脱落采样穿入违规均为0，退出码0，运行包哈希与性能测量一致。包含短触裂缝、跨0.5秒局部掉片、深按、滑动、松开继续向下掉落、近侧面厚度／间隙和重新开始。触屏片的捏压使用CDP真实触摸，旋转明确标注为鼠标辅助；视频按真实墙时录制，没有加速时钟，侧面截图仅辅助，不替代视频。可用 `node scripts/capture-clay-release-paw.cjs` 在本分支独立端口4256复现。

回滚猫爪性能增量时普通 revert 对应优化提交并 `npm run build:orb`，保留先前黏土薄蜡基线；整体撤销时使用 PR 的普通 revert。无存储迁移，不强推、不改写历史，不自动关闭范围更大的 Issue #38。PR #39 仍用于未验收的棉花糖阶段，不在本次合并中。
