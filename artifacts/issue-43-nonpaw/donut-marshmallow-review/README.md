# 甜甜圈棉花糖厚蜡走查

录屏按薄蜡白天、薄蜡夜晚、厚蜡白天、厚蜡夜晚播放。每组同模型、内芯、颜色、视角和操作。桌面使用鼠标，模拟手机使用 Chromium CDP 触摸。录屏用于检查裂口、内圈片径、长按分离、掉落、拖动和松手后的状态。录屏期间的几何探针会增加开销，性能采用单独的无录屏 A/B。

| 文件 | 内容 |
| --- | --- |
| [桌面录屏](donut-marshmallow-desktop.webm) | 1280 × 900 |
| [模拟触摸录屏](donut-marshmallow-mobile-emulated.webm) | 390 × 844 |
| [录屏检查](comparison-validation.json) | 各阶段实际采样及退出码 |
| [性能检查](performance-validation.json) | 5 轮 A/B 的完整采样和退出码 |

## 复现

```powershell
npm run build:orb
New-Item -ItemType Directory -Force .tmp | Out-Null
cmd.exe /d /c "git show 1762c5e:assets/orb-preview.js > .tmp/baseline-1762c5e.js"
$env:THICK_NONPAW_CORES='marshmallow'
$env:THICK_NONPAW_PERF_BASELINE='.tmp/baseline-1762c5e.js'
$env:THICK_NONPAW_OUTPUT='.tmp/donut-mm-perf-final'
$env:THICK_NONPAW_PERF_REPEATS='5'
node scripts/measure-thick-nonpaw.cjs
$env:THICK_NONPAW_STYLES='donut'
$env:THICK_NONPAW_COVERAGE='paired'
$env:THICK_NONPAW_OUTPUT='.tmp/donut-mm-review'
node scripts/capture-thick-nonpaw.cjs
```

性能对照的旧包 SHA256 为 `7845c796cbd273458f5e305b3c353ffca6a40ff3b33faa5e0de40d619a285cfe`，实测使用改动前复制的原始文件。

构建、五轮性能对照、两条录屏均退出 0。几何、独立防穿模、流程和预设回归 16/16，浏览器交互与范围回归 2/2，减少动态模式的甜甜圈棉花糖几何与防穿模 1/1，均退出 0。

```powershell
$env:THICK_NONPAW_STYLE='donut'
node --test --test-concurrency=1 tests/thick-wax-nonpaw-geometry.test.cjs tests/thick-wax-nonpaw-reference.test.cjs tests/thick-wax-nonpaw-sign.test.cjs tests/thick-wax-flow.test.cjs tests/wax-presets.test.cjs
$env:THIN_WAX_TEST_DPR='0.5'
node --test --test-concurrency=1 tests/thick-wax-nonpaw-browser.test.cjs
```
