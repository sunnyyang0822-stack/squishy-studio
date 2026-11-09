## 复现命令与结果

以下命令在项目工作树执行，原始输出位于同目录。没有改写真实浏览器时钟。

| 命令 | 环境 | 结果 |
| --- | --- | --- |
| npm run build:orb | c34a851 集成提交 | 退出 0 |
| node --test tests/thick-wax-flow.test.cjs tests/detail-state.test.cjs tests/medium-wax-core-flow.test.cjs tests/wax-presets.test.cjs tests/thick-wax-nonpaw-config.test.cjs | c34a851 集成构建 | 30/30，退出 0 |
| node --test --test-concurrency=1 tests/thick-wax-nonpaw-geometry.test.cjs tests/thick-wax-nonpaw-reference.test.cjs tests/thick-wax-nonpaw-sign.test.cjs | THICK_NONPAW_STYLE=donut，c34a851 集成构建 | 6/6，退出 0 |
| node --test --test-name-pattern='donut/marshmallow thick wax' tests/thick-wax-nonpaw-browser.test.cjs | THIN_WAX_TEST_DPR=0.5，THICK_NONPAW_STYLES=donut，THICK_NONPAW_CORES=marshmallow，c34a851 集成构建 | 1/1，退出 0 |
| node scripts/measure-thick-nonpaw.cjs | THICK_NONPAW_PERF_REPEATS=3，THICK_NONPAW_OUTPUT=artifacts/issue-43-nonpaw/final/performance | 18 轮，退出 0 |

最终构建 SHA256 为 7845c796cbd273458f5e305b3c353ffca6a40ff3b33faa5e0de40d619a285cfe。旧构建的测试结果和首轮录像诊断通过文件及报告中的构建版本区分。
