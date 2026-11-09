# 甜甜圈棉花糖长帧复测

对照旧包为 `98c5557`。新构建只给甜甜圈棉花糖厚蜡启用共享净空证明。候选样点沿用原有顶点、边中点、面心和断面。空间单元只用于找到邻近的已验证采样点，实际安全下界还要扣除位置差和期间的最大内芯运动量。接近阈值时执行原有的精确碰撞查询。

- [模拟触摸性能原始数据](mobile-performance-validation.json)
- [桌面鼠标性能原始数据](desktop-performance-validation.json)
- [桌面白天及夜晚薄厚录屏](donut-marshmallow-desktop.webm)
- [模拟触摸白天及夜晚薄厚录屏](donut-marshmallow-mobile-emulated.webm)
- [录屏几何检查](comparison-validation.json)

同触点浏览器计时使用 Edge，分别运行 CDP 模拟触摸和桌面鼠标。记录从页面接收按下事件到首次渲染完成、持续按压和随后 12 个拖动事件。单独录屏以检查外观和操作，避免几何探针干扰性能采样。

| 输入 | 首次渲染中位数 | 4 秒长按 P95 中位数 | 最长长按间隔 | 拖动 P95 中位数 |
| --- | ---: | ---: | ---: | ---: |
| 桌面鼠标，3 轮 | 107.9 → 80.9 ms | 81.3 → 28.0 ms | 391.9 → 58.6 ms | 24.1 → 23.8 ms |
| 模拟触摸，5 轮 | 86.7 → 63.6 ms | 68.1 → 26.6 ms | 321.6 → 52.6 ms | 21.8 → 26.3 ms |

两种输入合计，长按期间超过 100 ms 的间隔由 30 次降为 0 次。首次按压仍有可测延迟，模拟触摸拖动 P95 在这批采样略有上升。手机真机和 Safari 待测。两批测量退出码均为 0。

甜甜圈模型的共享净空数组为每个启用实例分配约 13.1 MiB。数组随外壳实例释放，其他组合沿用原内存分配。

```powershell
npm run build:orb
New-Item -ItemType Directory -Force .tmp | Out-Null
cmd.exe /d /c "git show 98c5557:assets/orb-preview.js > .tmp/baseline-98c5557.js"
$env:THICK_NONPAW_CORES='marshmallow'
$env:THICK_NONPAW_PERF_BASELINE='.tmp/baseline-98c5557.js'
$env:THICK_NONPAW_PERF_DRAG='1'
foreach ($deviceName in @('mobile-emulated','desktop')) {
  $env:THICK_NONPAW_PERF_DEVICE=$deviceName
  $env:THICK_NONPAW_PERF_REPEATS=if ($deviceName -eq 'desktop') {'3'} else {'5'}
  $env:THICK_NONPAW_OUTPUT='.tmp/donut-mm-followup-perf-'+$deviceName
  node scripts/measure-thick-nonpaw.cjs
}
$env:THICK_NONPAW_STYLES='donut'
$env:THICK_NONPAW_COVERAGE='paired'
$env:THICK_NONPAW_OUTPUT='.tmp/donut-mm-followup-review'
node scripts/capture-thick-nonpaw.cjs
```

构建、录屏、17 项常规回归、2 项浏览器回归和 1 项减少动态专项均退出 0。133 帧逐帧比较中，启用前后首帧的精确查询数为 27,898 → 13,213，峰值为 34,094 → 15,499。逐帧核对实际壳体坐标、法线、掉片和损伤状态。

```powershell
$env:THICK_NONPAW_STYLE='donut'
node --test --test-concurrency=1 tests/thick-wax-nonpaw-geometry.test.cjs tests/thick-wax-nonpaw-reference.test.cjs tests/thick-wax-nonpaw-sign.test.cjs tests/thick-wax-flow.test.cjs tests/wax-presets.test.cjs
$env:THIN_WAX_TEST_DPR='0.5'
node --test --test-concurrency=1 tests/thick-wax-nonpaw-browser.test.cjs
$env:THICK_NONPAW_FEEL='marshmallow'
$env:THICK_NONPAW_REDUCED='1'
node --test tests/thick-wax-nonpaw-geometry.test.cjs
```
