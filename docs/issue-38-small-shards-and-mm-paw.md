# 猫爪／甜甜圈碎块大小与棉花糖猫爪性能

用户追加要求：猫爪与甜甜圈的黏土、棉花糖同时缩小碎块，并优化棉花糖猫爪交互。此次外观变更先供重新查验，暂不合并；此前黏土303c802的30项GitHub检查已全部通过，不代表新候选自动获准。

薄蜡预设接收独立的 `styleId`，猫爪／甜甜圈选择 `fragmentSize:'small'`：260个种子，非凸连通岛拆分后分别278／271片，上限280；其他样式保持原180预算。活动碎片上限24、厚度0.014、normal支撑gap0.004、0.5秒驻留和原内芯参数不变。实际曲面平均分片面积分别缩小37.8%／38.7%，90百分位面积缩小41.5%／38.4%，典型边长约小21%。真实小片替代缩放掉落片，完整原面覆盖和全部剥落规则保留。黏土、棉花糖共用同一分片配置。

棉花糖猫爪的CPU采样确认主要开销来自大量实际芯面距离查询。完整支撑模式新增正间隙证书：上次实际正距离减去查询点位移及此后每帧全部芯顶点最大位移之和，仍大于安全阈值时才可省略精确查询；每个原有样点仍逐帧检查。界限失效立刻查真实芯面，没有运动界限的树禁用此优化。投影校正和持续恢复均计入实际位置变化。参考测试同时关闭距离证书与所有最近面缓存，逐帧比较真实Float32壳位置、法线及损伤状态。

特征法线的等距查询仍先执行完整BVH以保留原始面选择，仅对完全相同的查询点、完整局部三角面索引区域无变动的结果缓存；等距情况不建立允许移动的最近面证书。此优化仅用于完整支撑模式，黏土路径不启用。

最新运行包 SHA-256：`9d7d5b45fdc23037a2d8ff01843ec939ae9b79aebab95ca9ad21d0adb0d8af6e`。独立性能命令 `node scripts/benchmark-thin-wax.cjs artifacts/issue-38/mm-small-paw-final-performance.json`，THIN_WAX_BENCHMARK_URL指向4380的猫爪棉花糖制作预览，TEMP/TMP位于工作树.tmp/runtime；实际服务哈希与本地相等。Intel UHD／ANGLE D3D11、Windows Edge、390×844触屏模拟、全新配方真实按住4秒，79个完整间隔中位51.2ms、P95 78.0ms、最大101.4ms，退出码0。无其他本任务CPU测试、录像或profiler并发，全部间隔保留。修改前92.0ms／P95 114.8ms，记录同目录 `marshmallow-slide-fix-paw-performance.json`；当前约44%中位耗时下降，但仍有慢帧，不宣称60fps或真机流畅。

验证记录位于 `artifacts/issue-38/`：

- `small-fragments-certificates-tests.txt`：大小、缓存及特征法线7/7通过、退出码0；原77帧精确支持对照通过。
- `small-fragments-full-geometry.txt`：49/49通过、退出码0，包含八款黏土原面覆盖、片连通、全部剥落与清理；七款棉花糖深按／滑动／破口边缘／恢复及浅滑真实裂缝；原黏土／棉花糖内芯和预设回归。
- `small-fragments-final-certificates.txt`：最终标量证书版本与特征法线3/3通过、退出码0。
- `small-fragments-final-uncached-oracle.txt`：进一步同时关闭全部查询缓存与间隙证书，77帧位置／法线／损伤逐值一致，1/1通过、退出码0、24.13秒。
- `small-fragments-mm-final-browser-video.txt`：最终包猫爪／甜甜圈原生短滑、真实GPU裂缝、长按掉片、侧转和穿模检查2/2通过、退出码0、20.76秒；正常速度录像为 `paw-marshmallow-slide-and-fracture.webm` 与 `donut-marshmallow-slide-and-fracture.webm`。
- `small-fragments-clay-capture.txt`、`clay-style-videos-paw-donut.json`：两款黏土桌面及触屏模拟共四段正常速度录像完成、退出码0；对应上一e7b717包，之后仅调整棉花糖完整支撑证书的等价标量计算，黏土不受影响。桌面／手机近景、侧转、按压、掉落、重新开始均记录；手机旋转明确鼠标辅助。

黏土独立发布PR #42，棉花糖PR #39保持草稿。走查链接沿用4380，刷新并重新开始即可使用新分片；配置及导航损伤规则保持原合同。未验证手机真机、Safari及任意外部模型。回滚使用普通revert此次分片配置、查询优化与生成包提交，再运行 `npm run build:orb`；无需迁移存储，不改写共享历史。
