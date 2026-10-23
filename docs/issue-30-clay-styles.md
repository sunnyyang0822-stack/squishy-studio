# Issue #30：七种黏土样式交付

本轮从明确的 `origin/main` `1976819` 建立 `codex/issue-30-clay-styles`，独立工作树 `D:/squishy-studio-issue-30`。原工作区 `D:/squishy-studio` 及其中慢回弹执行者的未交接成果未移动或提交。仓库保持 Private。

产品在执行中明确将本轮缩为七款新增样式 × `clay`；棉花糖和慢回弹的新模型组合不在本轮验收范围。样式选择大厅由另一位执行者完成 PR #31，产品确认交接后，本分支合并 `origin/main aa78cc1` 并将八个大厅入口接入真实模型；保留大厅布局，不修改首页 Hero 或新增商城。Issue #30 不自动关闭。

## 已确认造型

| 稳定 ID | 中文名 | 本轮最终要求 |
| --- | --- | --- |
| `cloud` | 云朵 | 连续饱满正背面，保留云瓣轮廓，消除初稿交汇凹点 |
| `paw` | 猫爪 | 四趾，真实鼓起趾垫；主肉垫为倒心形，尖朝上、双圆瓣朝下 |
| `cylinder` | 圆柱 | 短胖体积、端侧圆滑过渡，无锐利盘边 |
| `donut` | 甜甜圈 | 环管半径由 .36 增至 .44，主半径 .72；外径 2.32、中孔直径 .56 |
| `pyramid` | 三角锥 | 产品确认三角形底面的圆钝四面体，默认略绕中心转向以显示体积 |
| `flower` | 五瓣花朵 | 产品最新指示覆盖原六瓣环：五个花瓣球＋一个鼓起中心花蕊球，共六球融合 |
| `star` | 五角星 | 五角清楚、星角圆钝、正反厚实、内凹连续 |

原 `orb` 圆球 GLB 未改。所有新资产均为单一闭合连续表皮，真实融合，没有相交内壳、独立浮空垫或外部贴图。运行时保留十色色卡，未把颜色或光学烘入模型。

## 资产和代码

- 源文件：`assets-source/squishy-<id>/squishy-<id>.blend`；同目录含 README 和 preview.png。
- 运行时：`assets/models/squishy-<id>.glb`。
- 复现：独立后台 Blender 4.4 执行 `blender --background --python scripts/build-styles.py -- <id>`；不要在未保存的交互场景执行会清场的生成脚本。
- 模型统计、正侧背底图及拼图：`artifacts/issue-30/models/`。坐标、包围盒、顶点/三角形数和字节以各 `<id>.json` 为准。glTF Y-up、正面 +Z、单位米、包围盒中心原点，所有对象变换已应用。
- 样式登记：`src/squishy-styles.mjs`；几何适配：`src/surface-clay.mjs`；共用场景、灯光：`src/orb-preview.js`；事务加载：`detail/adapters.js`。
- 配方和五步控制器：`detail/state.mjs`、`detail/page.js`。直接预览 `/squishy/cloud/?style=<id>`，未指定样式的旧链接仍为圆球。

大厅读取 `squishyStyles` 中的 `id/name/modelUrl/previewUrl`，并链接 `/squishy/cloud/?style=<id>`。不要复制场景或给每个模型另建黏土实现。新款明确仅允许黏土；不兼容内芯的切换被禁用并说明，非法组合直达会明确说明采用黏土。已有圆球的三种主线内芯行为保留；已合并的 PR #27 慢回弹及其独立外观预设原样接入。旧大厅 `preview=<id>` 链接迁移到真实模型，刷新与返回锚点保留样式。

## 几何、旋转和灯光

工厂新增可选空间查询契约，默认圆球分支保持原公式。参数和时序继续由 `getOrbFeel('clay')` 执行；等价球输入逐帧与默认工厂严格一致。详细失败案例和安全约束见 [独立验证](issue-30-validation.md)。新款恢复到自己的静止网格；未把凹形网格强制投影为球面。

旋转固定在原始几何中心，背景拖动只改姿态，接触阴影的高度跟随最低点而不搬动模型。测试检查实际网格 model-view 中心，避免把非对称模型轮廓自然变化误报为中心漂移。三角锥默认姿态和换色恢复使用同一个中心。

新款采用方向侧光、相机朝向补光、中性半球底光和环境补光。压痕通过真实坡面法线与有限的腔体明暗表现；昼夜旋转后的背面和底部也保留颜色。原圆球灯光分支保持。新增资产未携带 COLOR_0，运行时明确启用材质 vertexColors，防止只上传色卡而实际显示白色；真实像素换色测试覆盖此故障。

同模型换色继续复用 GPU 实例与既有动画。模型或质感改变先准备独立候选，提交最新请求后释放旧实例；过期、失败和未提交候选都会释放，失败保留旧画面和错误提示。几何验证在创建 WebGL 上下文之前完成。

## 验证与交付记录

最终逐组合表、录屏、昼夜桌面/触摸手机截图、各朝向灯光像素、性能观察和限制见 [独立验证](issue-30-validation.md)。七款 × 黏土常规流程全部通过，猫爪连接处安全限深另列，不声称原始21种组合完成。

- `npm run build`：退出0。
- `node scripts/test-port-isolated.cjs --check`：22个原测试文件与隔离helper语法、端口映射检查通过。
- `node scripts/test-port-isolated.cjs`：最终 **152/152通过，0失败、0跳过**，429.245秒，见 [最终日志](../artifacts/issue-30/final-tests.txt)。本地仅隔离服务端口，全部原断言保留；本地仍支持普通 `npm test`；CI四片各先构建，再执行 `node --test --test-concurrency=1 --test-shard=i/4 tests/*.test.cjs`。全部22文件互斥并集覆盖，片内串行避免GPU争用，原名 `browser-tests` 汇总检查要求四片全部成功。
- 首轮141/152暴露旧大厅单入口定位、返回URL兼容及新增测试多点一次隐藏返回按钮的问题，修正后重新执行整套。保留 [首轮日志](../artifacts/issue-30/full-tests.txt)，未删除或弱化断言。
- `node scripts/check-orb-baseline.cjs`：原圆球GLB字节未变，普通/减少动态两种模式共3054次操作的位置、状态、返回值与固定基线逐项严格相同。
- `PREVIEW_URL=http://127.0.0.1:4199 node capture-styles.cjs`：七款最终捕获退出0，七份实际操作录屏、桌面/模拟手机昼夜与多角度截图及GLB/运行包SHA见 [验证数据](../artifacts/issue-30/browser/validation.json)。
- `PREVIEW_URL=http://127.0.0.1:4199 node scripts/observe-styles-performance.cjs`：独立触摸观察退出0。无WebGL探针/录屏，以真实render-count变化计时；完整间隔保留在 [性能数据](../artifacts/issue-30/browser/performance.json)，同步测试负载与浏览器调度会影响结果，不视作手机FPS。

交付分支为 `codex/issue-30-clay-styles`；[PR #34](https://github.com/sunnyyang0822-stack/squishy-studio/pull/34) 指向main并关联Issue #30，保持Issue开放。远端检查与最终合并状态以该PR记录为准。

手机范围为开发机 Edge/Chromium 触屏模拟，未使用真机。CPU 形变和原生触摸模拟证明功能路径，不能代表低端手机 GPU、温升或硬件触感。几何厚度安全界限让猫爪局部薄垫比大体积区域压得浅，这是几何保护，不是重新调节黏土手感。

GitHub 软件 GPU 首轮为150/152，失败为换色中间帧漏采及猫爪按住1300ms仅上传4帧，见 [CI失败摘录](../artifacts/issue-30/ci-first-failure.txt)。换色与按压测试都改为受控时钟逐帧绘制真实GPU；按压仍为1300ms模拟时长，并额外断言至少30次真实位置上传。这样避免慢速渲染自然停帧早于固定更新次数而卡住；原48行颜色断言和25行样式断言逐字同序保留。新样式探针跟踪原生绑定调用，避免每帧同步GPU查询；CI选择已安装的完整Chromium新headless模式，与本地Chrome/Edge保持相同架构。产品运行包哈希未变，无需重做资产或视觉证据。相关颜色8/8与样式8/8回归通过，见 [颜色日志](../artifacts/issue-30/ci-color-regression.txt) 、[探针日志](../artifacts/issue-30/ci-probe-regression.txt) 和 [逐帧样式日志](../artifacts/issue-30/ci-style-regression.txt)；最新完整远端检查仍以PR记录为准。
## 回滚

按 PR 的交付提交执行正常 `git revert` 并重新构建。源 `.blend` 与对应 GLB 成对回滚，样式登记、详情配方与场景适配一起回滚；无数据迁移。不要强推或改写共享历史。本PR中的大厅接入与模型一起撤销，会恢复PR #31的圆球代体验链接；若有后续依赖，需一并协调。原球 GLB 和已确认黏土阻力参数不需要资产迁移。
