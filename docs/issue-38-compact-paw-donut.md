# 慢回弹猫爪／甜甜圈紧凑碎片修订

用户在 #47 走查中反馈猫爪严重卡顿、甜甜圈碎片过长并卡在芯面。本次继续同一独立工作分支，先供重新查验，不合并。仅慢回弹猫爪与甜甜圈制作预览显式传入 `compactPanels:true`；其他造型、黏土、棉花糖仍使用原分块配置。三个内芯工厂及压力、回弹参数未改。

## 分块与下落

原方案从球心发出 Voronoi 锥，在甜甜圈管面和猫爪薄连接上容易形成长条。紧凑方案按真实曲面三角形面积随机采样，再用少量候选填补大空隙，使用带常量的欧氏等距平面切分原三角形。生成顶点仍保存源面的重心坐标，附着层跟随原内芯；分区连通岛和断面封闭流程保持共用实现，没有将已脱落片视觉缩小。

两款各 260 片，上限 280、同时活动 24。按真实片顶点两两距离测量，猫爪最长尺寸从 0.8566 降到 0.3956 模型单位，甜甜圈从 0.8303 降到 0.4034；甜甜圈 P95 为 0.3561。包围盒对角线另记录，未混作真实直径。每个原三角形的裁切面积相加与原面积相等（相对容差 1e-5、绝对 1e-10），无漏面或删面。厚度仍 0.014、normal 间隔 0.004、几何容差 1e-5。

世界重力、原连续驻留 0.5 秒和碎片寿命均未修改。实际验证先深按掉 3 片，再松手让内芯慢恢复，逐帧检查真实碎片质心在原角度及 Y 旋转 110°后均能至少下降 0.4 世界单位；测量在清理之前进行，不能以消失冒充掉落。附着、内外断面和脱落片均测量实际最近芯面，未用透明、深度排序或穿芯捷径放行。未掉的附着片保留，松手不自动剥光。

## 支撑查询优化

只有 `compactPanels` 分支默认启用 `relativeSupport`。碰撞树记录真实三角形上一帧／当前帧的联合包围盒和三个顶点位移。对每片取其平均源点平移作为参考系，计算邻域内所有相关芯顶点相对这次平移的最大位移；无变化节点也计入参考系移动量。对原有每个样本，用上次正间隔减去这个界限及样本在该参考系里的剩余位移，仍大于 0.0005 时才能复用安全证明，否则查询实际芯面。

前后两个样本必须都离查询区域边界足够远；芯面跨越区域的前后联合包围盒同样参加检查。只允许连续两次 refit 之间的证书，跳帧、恢复、投影或大幅拖动会使证明失效。全部原顶点、面心、边及侧壁样点仍参与，未降低采样。关闭证书、附着缓存、查询缓存、惰性法线及网格平局优化的参考实现，与候选实际 Float32 壳位置、法线、损伤逐帧相等；包括深按、快速折返、100ms 壳刷新、松手、显式恢复、重开。

曾尝试细网格、逐面扫掠检查及位移区间方案，成本或内存回退较差，未保留。空间网格恢复原 .025，原百万单元／链接上限保留，不以提高内存预算掩盖卡顿。

## 证据与限制

`tests/wax-compact-panels.test.cjs` 记录完整面积覆盖、最长片尺寸和穿越区域的运动界限；`tests/wax-compact-fall.test.cjs` 检查两角度真实下落轨迹与动态芯碰撞；`tests/wax-compact-support.test.cjs` 比较完整计算参考。最终运行 `node --test --test-concurrency=1 tests/wax-compact-support.test.cjs tests/wax-compact-panels.test.cjs tests/wax-compact-fall.test.cjs tests/wax-slow-rebound-style-geometry.test.cjs tests/wax-collision-cache.test.cjs tests/wax-small-fragments.test.cjs`，20/20、退出0、312.96秒。逐阶段间隔、位移与退出码见 `artifacts/issue-38/paw-donut-release-geometry.txt`。之前候选的九项几何验证也保留于 `compact-bvh-motion-final-validation.txt`，不冒充最终性能数据。

`$env:WAX_SLOW_STYLE='paw,donut'; $env:WAX_SLOW_RECORD='1'; node --test --test-concurrency=1 tests/wax-slow-rebound-style-browser.test.cjs`：4/4，退出 0，112.87秒。Windows Edge、桌面鼠标和390×844触屏模拟，原生输入、实际 GPU 上传误差0，短按不掉片、跨阈值碎裂、深按、慢恢复、侧转、导航与重开。正常速度视频为 `paw-slow-rebound-desktop.webm`、`paw-slow-rebound-mobile.webm`、`donut-slow-rebound-desktop.webm`、`donut-slow-rebound-mobile.webm`，截图仅辅助。

性能使用 `node scripts/benchmark-compact-wax.cjs OUTPUT BASELINE_PRESET_ABSOLUTE_PATH paw`。基线为当前 PR 的 `4ea169c` 原分块及查询，不使用更老的 c8 基线作为当前修复收益。相同真实内芯和模拟60Hz输入，旧／新蜡每帧交替执行，阶段末对两实现都做完整体积防穿模检查；分块本身有意变化，因此不宣称旧／新拓扑坐标相等。输出 `paw-compact-paired-current.json`／TXT，退出0：猫爪按压中位65.31→59.02ms，滑动170.73→96.12ms，恢复68.37→50.00ms。CPU配对测量不是浏览器帧率。

实际 Edge／Intel UHD 触屏模拟帧间隔波动很大，本轮机器上另有其他任务的浏览器基准运行，未停止其他协作者进程。所有原始数据包括慢帧保留：`paw-slow-release-performance.json`、`donut-slow-release-performance.json`；猫爪滑动中位仍153.8ms，不能据最早24ms按压的一次记录宣称流畅或60fps。当前是有算法收益的修订候选，猫爪性能仍需用户走查并进一步优化；甜甜圈不能只凭缩短碎片认定体验通过。未验证真机或Safari。

#47 原CI另有两个阻塞：Linux Chromium 的临时 socket 路径过长，测试临时目录缩短为仓库 `.tmp`；新区域滑动测试的120ms定时器被软件光栅化延迟到548ms，改为观测可信 pointermove 之后第一笔真实内芯 GPU 上传再结束施力，仍要求小于500ms且新区域不新增掉片。只改测试观测，不改产品时钟。对应本地输出 `fresh-contact-upload-ci-fix.txt`，1/1、退出0。简短临时目录的软件 WebGL 云朵验证 `slow-style-short-temp-software-validation.txt` 1/1、退出0、32.92秒；本机为Windows，不将其写成Linux实测通过，Linux结果仍待GitHub检查。

回滚：普通 revert 本次修订提交，再 `npm run build:orb`；恢复原分块及支撑实现，无持久数据迁移。不改写共享历史、不关闭 #38，待用户验收且所有必需检查通过后再合并。
