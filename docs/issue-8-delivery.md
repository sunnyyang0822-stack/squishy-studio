# Issue #8 第二屏交付记录

## 基线与范围

- 基线：`origin/main` 的 `ab1420733dca02cac9beb81b14b736270a507548`。
- 工作分支：`codex/home-sample-showcase`。
- 执行时为原生 HTML/CSS/JavaScript＋Three.js，没有迁移框架或新增依赖。
- 首页保留原 Hero，新增四只静态样例和真实大厅链接；`/collections/` 为最小独立大厅，仅一个制作中合集。
- 参考抖音页面当前无法通过本次工具访问，未实际观看；未使用博主资产。原创插画来源见 `assets/samples/README.md`。

## 模块边界

- `styles.css`、`src/brand3d.js`、`main.js` 均保持原样。首页仅为 Hero 增加一个不带样式的 main 外层，将原 `.scene` 容器保持为同样布局的 div，并在其后追加样例区。
- `showcase.css` 只控制新样例区和大厅，普通图片替代多场景 WebGL。
- `showcase.js` 只负责样例图片失败时的稳定降级，没有按压、播放、假进度或商品点击行为。
- `theme-preference.js` 在样式前读取合法的 day/night 偏好，并在原开关完成状态变更后保存，不改写 Hero 的切换参数。
- 服务增加目录 index.html 解析，以及 `/collections` 到 `/collections/` 的真实重定向。大厅可直接打开、刷新；显式返回定位 `/#samples`，浏览器返回使用原生恢复。

## 本地验证

环境：Windows，Node v24.21.0、npm 11.19.0、Git 2.55.0.windows.3，本机 Edge＋Playwright。浏览器证据为桌面浏览器及移动视口模拟，不声称已完成真机性能验收。

- `npm test`：16 项通过，退出码 0；pretest 同时实际执行 `npm run build:brand`。覆盖原有 Hero、新样例、鼠标/键盘/触屏入口、独立大厅直达与刷新、两种返回、跨页主题、减少动态效果、图片失败与存储禁用。
- `npm run capture:showcase`：退出码 0，生成截图、导航录屏及 Hero 回归报告。
- `npm run build:brand`：单独执行成功，退出码 0；输出保存为 `artifacts/issue-8/build-output.txt`。
- 最终测试输出保存为 `artifacts/issue-8/test-output.txt`。补充真实触屏 tap 验证时曾出现断言早于页面导航提交的测试时序问题；已改成等待实际大厅 URL 后断言，保留该次失败输出 `test-output-initial-touch.txt`，没有删除状态或可达性断言。
- 没有通用框架生产构建脚本；适用构建为现有 `npm run build:brand`，不引用不存在的构建命令。

## Hero 回归

视口：1440×900、390×844、375×667、320×568、844×390。

`artifacts/issue-8/hero-baseline.json` 保存修改前 Hero 与品牌主体坐标，`hero-regression.json` 保存修改后对照。五种视口的两组坐标完全一致；本次白天截图像素一致，夜晚仅有 8 位色彩通道 1/255 级的合成舍入差异，没有超出一级的变化。

捕获器等待实际画布显现和主题过渡结束，不用固定等待冒充渲染完成。比较时保留精确变化数量和最大通道差，不隐藏差异；阈值仅容许单级色彩舍入。跨操作系统不复用此像素结论。

## 视觉证据

所有文件位于 `artifacts/issue-8/`：

- `hero-before-{desktop,mobile,compact,short,landscape}-{day,night}.png`：修改前 Hero。
- `hero-after-{desktop,mobile,compact,short,landscape}-{day,night}.png`：修改后 Hero。
- `samples-{desktop,mobile,compact,short,landscape}-{day,night}.png`：第二屏昼夜样例，包含短屏与横屏。
- `hall-desktop-day.png`、`hall-desktop-night.png`、`hall-mobile-day.png`、`hall-mobile-night.png`：大厅入口。
- `samples-image-failure.png`：四张样例图片失败，尺寸稳定且主入口可用。
- `return-to-samples.png`：返回首页的定位。
- `navigation-demo.webm`：Hero → 原生滚动到样例 → 昼夜变化 → 大厅 → 刷新 → 返回样例 → 白天大厅。

## 限制与回滚

- 样例为静态视觉方向，没有可玩数量承诺；合集制作中，没有开始按钮。
- 未实现完整大厅、预览弹窗、正式体验页、按压/碎裂/声音、GLB、多主题资源、账号或数据库业务。
- 浏览器禁用 localStorage 时可继续浏览和切换当前页面，但无法跨导航持久化偏好。旧浏览器不支持 CSS 注册颜色插值时，静态显示和导航仍可用，新区域的背景颜色可能直接变化。
- 短屏的样例区允许自然纵向滚动，不强迫所有样例和入口塞在同一视口；没有横向查找入口的要求。
- 回滚时 revert 本 PR 的合并提交（merge commit 使用 `git revert -m 1`），不强推、不改写共享历史。
- GitHub 检查与合并状态以关联 PR 的实际记录为准；此文件不预先宣称远端检查已通过。
