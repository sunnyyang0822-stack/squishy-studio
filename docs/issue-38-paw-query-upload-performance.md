# 猫爪查询与 GPU 上传优化候选

继续修订 #47 的慢回弹猫爪，供用户重新走查，不合并。当前 CPU 热点是完整蜡体积支撑检查，滑动还涉及原模型全三角形拾取和最近顶点搜索。本次保留完整真实壳面、断面、碰撞样本、掉片数量、0.5 秒阈值、厚度 0.014 与 normal 间隔 0.004；三个内芯工厂及参数没有修改。

公共薄蜡循环缓存源点移动标记、映射输入版本及每片运动界限，省去重复向量调用、重复映射及已清零碎片的重复写入。连续帧的局部支撑证明仍检查全部原样本；无前后投影时，由原前后角点包围盒的 0.05 padding 保证小于 0.04 的距离边界；发生投影则回到逐点边界检查。实际折叠夹具触发 18 次修正，优化结果与关闭全部缓存、支撑证明的参考实现逐个 Float32 坐标及法线相等。

每片写入后追加 position/normal 的实际更新范围，由 Three 消费；不清掉尚未上传的范围。两个属性分别追踪消费批次，同片同批次至多一个范围，防止没有 render 的重复 sync 使范围无限增长。200 次连续 sync、独立属性消费和重新开始另有测试。两种实际浏览器输入下，九个阶段实际 GPU 芯壳坐标误差全部为 0；每渲染帧上传量平均为完整两缓冲的 19.13%（鼠标）／16.35%（触屏）。该比例不是 FPS。

慢回弹猫爪显式开启 `fastPicking`，复用既有碰撞树拓扑和真实三角形做精确 raycast；原始曲面仅增加静态节点包围盒，不复制场景或创建输入控件。4,800 次 live/rest、正反双面、旋转、非均匀缩放、drawRange 与漏空查询和原 Three Raycaster 的最大位置误差为 0。查询时间总和 1728.60→14.61ms 是单独查询测试，不代表整帧收益。几何适配的 `fastNearest` 复用原静态树剪枝，仍用原 Math.hypot 距离与最低索引平局，186 帧真实慢回弹状态和全部芯坐标逐值一致，裸芯外形和手感不变。

## 本地验证

真实命令、输出及退出码位于 `artifacts/issue-38/`：

- `node --test --test-concurrency=1 tests/wax-compact-support.test.cjs tests/wax-cloud-reuse.test.cjs tests/wax-support-projection.test.cjs tests/wax-upload-ranges.test.cjs tests/wax-paw-picking.test.cjs tests/paw-nearest-index.test.cjs`：`paw-indexed-final-oracles.txt`，11/11、退出 0、88.82 秒。包含 85,065 次原几何最近面／特征法线核对、真实投影失效及 compact 猫爪／甜甜圈的完整参考比较。
- `node --test --test-concurrency=1 tests/wax-paw-upload-browser.test.cjs`：`paw-indexed-final-gpu-browser.txt`，2/2、退出 0、18.66 秒。实际 GPU 验证深按、折返滑动、恢复、重开；最小 normal 间隔 0.00399994、实际最近面 signed 距离不小于 0.00352332，厚度 0.014，容差 1e-5。
- `node --test --test-concurrency=1 tests/wax-slow-rebound-style-geometry.test.cjs tests/wax-marshmallow-style-geometry.test.cjs`：`paw-indexed-seven-style-regression.txt`，14/14、退出 0、174.30 秒；慢回弹／棉花糖各七款逐帧原芯一致、深压、滑动、重复破口及恢复的实际体积回归。
- `$env:WAX_SLOW_STYLE='paw'; $env:WAX_SLOW_RECORD='1'; node --test --test-concurrency=1 tests/wax-slow-rebound-style-browser.test.cjs`：`paw-indexed-final-browser-video.txt`，2/2、退出 0、52.30 秒。正常速度录像更新为 `paw-slow-rebound-desktop.webm` 和 `paw-slow-rebound-mobile.webm`，覆盖短按、0.5 秒跨阈值、深按、完整自然恢复、侧转、保留破口的导航和重开。

配对 CPU 测量 `node scripts/benchmark-wax-support-paired.cjs artifacts/issue-38/paw-support-mapping-paired.json <9133330版绝对预设路径> paw`，退出 0。相同 compact 拓扑、真实芯面和模拟 60Hz 输入，同进程交替执行旧／新蜡计算，阶段末对实际 Float32 输出、损伤严格比较并分别检查完整体积。按压／拖动／恢复中位 27.067→25.102、58.821→53.064、34.824→30.227ms。该测量只说明蜡计算收益，不含后续拾取和最近顶点优化，不是浏览器帧率。

独立真实交互 `WAX_INTERACTION_URL=<4382 猫爪走查 URL> node scripts/benchmark-wax-interaction.cjs artifacts/issue-38/paw-indexed-final-performance.json`，退出 0。Windows Edge／Intel UHD、390×844 桌面触屏模拟，服务 bundle 哈希匹配，无本任务并发测试、录屏或 profiler，所有慢帧保留。按压／恢复／滑动／滑动后恢复帧间隔中位 20.7／24.6／63.1／41.6ms，P95 85.5／32.6／90.8／53.6ms。滑动仍明显超过帧预算，不能称为流畅或稳定 60fps；没有手机真机及 Safari 验证。此前机器负载不一致的 153.8ms 记录不能作为本轮可比基线。

曾尝试额外空间安全球／棱柱证明，配对收益不足，未保留产品代码。继续优化应围绕完整支撑查询成本测量，不能删碰撞样本、减少碎片或改内芯手感掩盖卡顿。

回滚使用普通 revert 本次优化提交并 `npm run build:orb`，恢复原查询与全量上传；无数据迁移。PR47 保持 draft，用户重新验收和必需 CI 通过前不合并，不关闭 #38。

远端核查：前一提交 `9133330` 的六个浏览器 shard 全部成功；部分独立 style job 未启动，GitHub check 注释为 “recent account payments have failed or your spending limit needs to be increased”。没有测试步骤和测试日志，不能记作产品测试失败或通过。本轮提交重新触发检查后以其实际状态为准，不能在有阻塞检查时合并。
