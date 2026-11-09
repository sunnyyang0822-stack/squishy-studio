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
node --test --test-concurrency=1 tests/thick-wax-nonpaw-geometry.test.cjs
THICK_NONPAW_STYLE=donut, THICK_NONPAW_REDUCED=1
Final reduced-motion donut: 3 passed, exit 0, 127136.9722 ms. Raw latest-donut-reduced.txt.

Final capture command: node scripts/capture-thick-nonpaw.cjs [--resume].
All batches: THICK_NONPAW_COVERAGE=paired. First run: THICK_NONPAW_STYLES=donut,cloud,cylinder,pyramid,flower,star, THICK_NONPAW_OUTPUT=artifacts/issue-43-nonpaw/final/latest-comparison, default port 4381. Ended at the batch handoff after retaining completed cases. Subsequent batches:
- cloud,cylinder / 4384 / same output, --resume
- pyramid,flower / 4385 / .tmp/comparison-pyramid-flower
- star / 4386 / .tmp/comparison-star
Capture batch outputs and the consolidated same-bundle report are recorded alongside the media. Worktree temporary folders are excluded from the commit.
Consolidation: 36 complete videos, 84 matched segments, same SHA256, all three final batches exit 0.
