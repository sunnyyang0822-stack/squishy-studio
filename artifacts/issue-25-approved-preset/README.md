# 慢回弹确认预设：交付证据

2026-11-05录制，2026-11-06提交验证。基线及参数见 [复用合同](../../docs/slow-rebound-approved-preset.md)。此目录不含浏览器配置或临时运行文件。

| 实际命令 | 结果 | 输出 |
| --- | --- | --- |
| `node --test tests/slow-rebound-preset.test.cjs tests/slow-orb-depth.test.cjs tests/orb-slow-rebound.test.cjs tests/squishy-slow-rebound.test.cjs` | 47通过，退出0 | [几何](geometry-tests.txt) |
| `node --test tests/slow-orb-depth-browser.test.cjs tests/orb-slow-rebound-browser.test.cjs tests/squishy-slow-rebound-browser.test.cjs` | 20通过，退出0 | [真实GPU](browser-tests.txt) |
| `node scripts/check-slow-rebound-baseline.cjs` | 显式旧配置2622操作严格相等，退出0；当前默认有意更新 | [旧配置回归](legacy-baseline.txt) |
| `node scripts/capture-slow-approved.cjs` | 两段正常速度录屏，页面错误0，退出0 | [命令输出](capture.txt)、[量测](validation.json) |
| `npm test`（含完整构建） | 首次526项：520通过、6失败，退出1；保留原始结果 | [首次全量](npm-test.txt) |
| `node --test tests/orb-slow-rebound-wax.test.cjs tests/polish-core-support.test.cjs tests/thick-wax-orb-cores.test.cjs tests/wax-compact-fall.test.cjs tests/polish-other-cores-browser.test.cjs` | 修复后17通过、1超时取消，退出1；该项单独重跑通过 | [外壳兼容](compatibility-tests.txt) |
| `CI=true DEBUG=pw:api node --test --test-name-pattern='^butter polish actual GPU' tests/polish-other-cores-browser.test.cjs` | 同一桌面用例重跑1通过，退出0；含API轨迹 | [桌面重跑](polish-desktop-trace.txt) |

首次全量失败并非被跳过：旧15秒自然恢复上限改为16秒（仍精确归原始坐标）；指甲油深坑启用既有膜层逐面安全投影（仍要求零穿入）；猫爪碎片观察到2.5秒（仍需真实下落.4单位且不能靠消失通过）。桌面并发重跑出现200秒测试超时，同一用例单独运行实际断言约45秒完成、浏览器退出后总耗时174秒，退出0。没有提高该测试超时或放宽支撑断言。完整GitHub重新验证结果见 [PR #59检查](https://github.com/sunnyyang0822-stack/squishy-studio/pull/59/checks)，必须全部成功才合并。

## 正常速度影像

- [桌面鼠标录屏](desktop-mouse.webm)
- [手机视口CDP触屏录屏](mobile-touch.webm)
- [桌面昼间深压](desktop-mouse-full-press.png)、[桌面夜间深压](desktop-mouse-night-deep.png)、[桌面夜间恢复](desktop-mouse-night-rest.png)
- [模拟手机昼间深压](mobile-touch-full-press.png)、[模拟手机夜间深压](mobile-touch-night-deep.png)、[模拟手机夜间恢复](mobile-touch-night-rest.png)

两段录屏都包含短按、长按、起点驻留→滑动→终点驻留、恢复中再按、长划折返、换色中断；每个完整恢复阶段均等待所有GPU上传坐标与真实GLB原始坐标逐值相等，再记录误差0。没有强制reset或改时钟加速回弹。昼夜灯光保持主线设置。手机仅模拟器，未真机验证。
