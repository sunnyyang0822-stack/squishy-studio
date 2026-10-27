# 慢回弹薄蜡扩展与云朵性能

关联 #38。基线从 `49dfefd` 的已批准圆球工作分支继续，交付前正常合入最新 `origin/main`（含圆球合并 `398d58c`），保留独立 `codex/issue-38-slow-styles-preview` 工作分支。用户批准慢回弹圆球外形与薄蜡，并授权复用到其余七款；云朵、猫爪、圆柱、甜甜圈、三角锥、花朵、五角星现通过制作预览调用同一 `thin-wax` 预设，视觉验收后才合并。既有黏土及棉花糖交付由 PR #42、#39 合并。本次不开发最终试捏、托盘、中厚蜡或其他壳材料。

## 接入与状态

`detail/state.mjs` 将已登记的八款 `butter × wax × thin` 映射到原 `slow-rebound`／`full-matte`；`src/orb-preview.js` 对非圆球显式开启 `fullSurfaceSupport`，沿用单一输入及真实芯面。内芯步骤裸芯，外壳／装饰步骤保留损伤；进入最终试捏隐藏预览壳并保留状态，返回制作不修复。主动换配置或重开使用原恢复与销毁流程。未改动三个内芯工厂及其参数。

实际壳厚仍为 0.014 模型单位，source-normal 间隔 0.004，测量容差 1e-5；圆球半径约 1 单位，薄壳厚度约其 1.4%。沿用已批准的厚度与间隔，使断面可见且保持贴合，不依赖透明或深度排序。连续局部驻留超过 0.5 秒才掉片，移动、取消及后台沿用原时钟规则。猫爪／甜甜圈复用 260 种子、280 总片预算，其他款 180；同时活动仍为 24，制作预览不收集碎片。薄连接达到原内芯安全限深后，不凭时间继续剥光。

## 性能改动与正确性

- 附着片仅在其所有源坐标、法线、损伤都不变，且全部变化芯三角形的前后联合包围盒均未触及整片带安全余量的壳体时复用上次输出。相邻芯面跨越壳体会使缓存失效。
- 顶点角加权及边特征法线改为按实际查询计算，保留完整求和顺序；反射、内外符号与防穿模公式不变。
- 局部网格遇到同距离三角形时，通过最近公共祖先的实时子节点包围盒及叶片顺序，选出与原 BVH 遍历完全相同的面，避免重复遍历整树。保留关闭优化的测试入口，85,065 次七模型查询比较最近面、法线和有符号距离严格相等。
- 静态厚度射线以相同标量算术替代每三角形的临时数组，云朵／猫爪／甜甜圈的半径、方向及逐帧内芯状态严格相等。

全部真实内外顶点、面心、唯一边中点及断面样本继续约束；未减少样本、跳过动态碰撞或修改回弹参数。开发中试过的逐面 AABB 剪枝及增量特征法线没有保留，旧测量保留在本地，不作为当前性能证据。

## 验证记录

`node --test --test-concurrency=1 tests/wax-slow-rebound-style-geometry.test.cjs tests/wax-cloud-reuse.test.cjs tests/surface-thickness-scalar.test.cjs`：15/15、退出 0，138.12 秒。完整输出 `artifacts/issue-38/slow-styles-final-geometry.txt`。七款有壳／裸芯的原内芯逐帧严格相等；检查深压、拖动、重复破口、取消、10Hz 壳刷新时的完整自然恢复，附着及脱落几何零穿入，损伤不自愈。云朵／棉花糖另与关闭全部缓存、完整特征法线、原 BVH 平局回退的壳体逐帧 Float32 坐标及法线比较相等。测量覆盖真实壳内外表面与侧壁，详细每阶段最小间隔与厚度误差均在输出内。

最终局部裂边缓存版再运行 `node --test --test-concurrency=1 tests/wax-slow-rebound-style-geometry.test.cjs tests/wax-marshmallow-style-geometry.test.cjs tests/wax-presets.test.cjs tests/wax-collection-tray.test.cjs`：20/20、退出0、142.32秒，见 `slow-styles-delivery-geometry-preset.txt`。覆盖慢回弹／棉花糖各七款、预设实例隔离、重开、离页释放及托盘独立资源。额外流程、输入及碰撞回归 `slow-styles-final-flow-collision.txt` 30/30、退出0；原黏土／圆球慢回弹及棉花糖回归 `slow-styles-existing-feels-regression.txt` 25/25、退出0。

配对 CPU 测量 `node scripts/benchmark-wax-kernel-paired.cjs artifacts/issue-38/cloud-paired-kernel-local-cracks.json <旧版的绝对 src/wax-presets.mjs 路径>`，退出 0。基线为 `c8b6889` 原薄蜡，在同一进程使用完全相同的云朵芯面、模拟 60Hz 输入，逐帧交替两实现的执行顺序，阶段末断言实际 Float32 输出及损伤相等。最终局部裂边缓存版按压／拖动／恢复蜡计算中位耗时由 22.99／38.39／23.02ms 变为 11.07／27.04／17.33ms；这是 CPU 计算比较，不是浏览器 FPS。逐帧数据及全部峰值保留在 JSON；全局裂纹缓存版旧记录 `cloud-paired-kernel-final.json` 属历史阶段，不与本次混用。

独立浏览器命令 `node scripts/benchmark-wax-interaction.cjs artifacts/issue-38/cloud-slow-interaction-local-cracks.json`，退出 0。Windows Edge 156、Intel UHD／ANGLE D3D11、390×844 桌面触屏模拟，真实按压、滑动及恢复，无本任务并发测试、录屏或 profiler。服务包哈希与本地匹配：`1bc40f44ecf57e3a5975242098f1cc4a655c219f3d38a89792b60428b343f268`。按压／恢复／拖动／拖动后恢复的帧间隔中位 9.1／11.6／33.3／16.7ms，P95 34.2／17.3／49.2／24.8ms；原始间隔全部保留。拖动仍超过 60fps 帧预算，未声称稳定 60fps；此前独立运行波动较大，优先用配对 CPU 比较说明算法收益。未验证手机真机及 Safari，桌面模拟不代表真机帧率。

局部裂边缓存前，`$env:WAX_SLOW_RECORD='1'; node --test --test-concurrency=1 tests/wax-slow-rebound-style-browser.test.cjs` 10/10、退出0，217.83秒；局部裂边缓存后云朵桌面／触屏另录当前版本，2/2、退出0、42.08秒，见 `cloud-local-cracks-final-browser-video.txt`，几何输出与完整重算的逐帧严格相等另由 `cloud-local-crack-reuse-oracle.txt` 5/5、退出0覆盖。公共方案也记录于 [预设合同](thin-wax-preset.md)。正常速度录像及流程回归另见 `slow-styles-final-browser-video.txt` 和各 `*-slow-rebound-*.webm`。短按、跨阈值首次碎裂、继续深按、松手恢复、侧转、永久破口、重开及导航均通过真实输入驱动；截图仅辅助几何检查。此前猫爪测试把压力标量、全局最大位移及接触片局部应变混用，失败输出保留为 `slow-styles-browser-depth-metric-attempt.txt`、`slow-paw-global-depth-attempt.txt`；最终对一般造型要求新深按增加掉片，猫爪／甜甜圈若无新掉片则检查接触片剩余应变不超 .015，原核心与薄蜡参数未因测试调整。

走查：`http://127.0.0.1:4382/squishy/cloud/?style=cloud&coreMaterial=butter&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`。替换 `style` 为上述已登记 ID 可检查其他款。

回滚使用普通 revert 撤销扩展／优化提交并 `npm run build:orb`，不改写共享历史。壳状态属实例内存，重建或离页释放；回滚不涉及持久数据迁移。PR 关联 #38，但不自动关闭整个 Issue。
