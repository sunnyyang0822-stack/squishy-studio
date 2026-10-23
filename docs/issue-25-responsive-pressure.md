# Issue #25：渐进按下、适度滑痕与持续深压

2026-10-23，从明确的 `origin/main` `2bf30c3` 建立 `codex/issue-25-responsive-pressure`，随后合入最新主线 `5a8350a`，保留制作流程与其他样式的交付。

用户确认松手回弹正确，要求按下有过程、速度均匀；拖动减轻，长按可以更深。灯光由其他工作统一修改，本次只调整独立慢回弹工厂及其测试、构建和证据，不修改黏土、棉花糖、场景、光照、材质、色彩或模型。

## 参数与行为

- `pressSpeed: .45` 模型单位/秒，`pressOnsetSeconds: .12`。前120ms速度平滑上升，随后匀速深入，消除先猛陷再缓慢逼近的过程。
- 起步采用精确时间积分：`F(t)=t²/(2r)`（t<r），否则 `F(t)=t-r/2`。每帧使用 `F(t+dt)-F(t)`，不按事件或帧数累计。
- 长按最大深度由 `.34` 提升为 `.46`；`radialLimit: .50`，每个顶点至少保留原始半径的50%。约0.82秒达到旧深度，继续长按约1.09秒达到新限深。前段压入速度不变。实际网格全三角形朝外与边界检查仍保留。
- 拖动速度从上一轮 `1.8` 减至 `1.1`，移动时限深 `.20`，使滑痕浅于长按。实际路径累计超过 `.04` 模型单位后启用移动反馈；新途经点只接收当前帧当地接触量，不继承整次按住时长或旧压深。
- 最近移动后保留 `.12s` 的拖动限制，覆盖10Hz稀疏事件间隔；停留后按静止速度继续深入至 `.46`。过渡期间继续请求帧，避免恰好达到移动限深后停帧卡住。
- 每次 begin/release/cancel/reset/beginRestore 清理本次移动距离与时间。实例状态独立；输入、恢复、换色与清理继续复用统一接口。

释放速率 `.80/s`、减少动态速率 `5/s` 和收敛阈值 `.00001` 均保持不变。深压后的恢复时间随初始深度自然增加，恢复曲线没有改快或改慢。显式换色恢复独占网格；新输入从当前形态接管。隐藏页面时取消接触并暂停渲染，回到前台按既有协调恢复，避免后台时间成为额外按压量。

## 实际 GLB 几何验证

以原始静止 GLB 每个顶点为基准，测最大欧氏位移；路径测量取对应球面角度的最近原始顶点。

| 按压时刻 | 最大凹陷 |
| --- | ---: |
| 首帧16.7ms | .000520 |
| 100ms | .018702 |
| 300ms | .107725 |
| 长按3s | .458827 |

120/170/220ms深度为 `.026931/.049374/.071816`，两个50ms间隔均深入 `.022443`，增量误差限 `.000001`。测试另检查870ms深度处于 `.35–.38`，继续400ms达到 `.44–.46`，证明长按继续深入而非加快首帧。

起点驻留2.5s→滑动.7s→终点驻留1.3s，起点旧痕/中段/终点深度 `.095180/.046099/.456711`。较旧起点在终点驻留期间已开始恢复；中段约终点10%，整条路径自然恢复。

4s长按释放后，正常约13.43s、减少动态约2.15s精确归位；所有顶点与原始 Float32 坐标完全相等，误差0，再进入 `needsFrame:false`。最后收敛步小于 `.000011` 模型单位，在350显示像素/模型单位下不足 `.004px`，不可见。14秒时长上限不变，未通过重置冒充恢复。

30/60/120Hz及10Hz输入下同一路径最大坐标误差 `.002956`，小于原有 `.004` 容差。深压长按、快慢长划、折返、交叉、反复揉压、恢复中重按、取消、reset、减少动态、实例隔离、全三角形朝外与无NaN检查均保留。

## 命令与记录

- `npm test`：含构建及完整黏土、其他样式和浏览器回归。深压参数完整运行157项，156通过、1项旧后台断言失败，输出见 [tests-deep-hold-final.txt](../artifacts/issue-25-responsive/tests-deep-hold-final.txt)。旧断言将100ms内位移固定限制为.04；更深压痕自然回弹的实际.0459超出旧值。改为逐个实际GPU上传帧对照原.80/s指数曲线，误差限.000002，并验证首帧仅推进1/60秒，不计入后台1.3秒；没有放宽固定容差或修改产品恢复。修正后本次全部23项几何/浏览器测试通过，失败0、跳过0、退出0，耗时108.49秒，结果见 [tests-preset-final.txt](../artifacts/issue-25-responsive/tests-preset-final.txt)；最终完整回归另以PR GitHub检查为准。
- `node scripts/capture-slow-feedback.cjs`：正常墙钟速度、真实鼠标与CDP触屏模拟，300ms短按、1.5秒长按、连续滑动与终点驻留，每段松手后持续录至GPU坐标精确归位。没有加速播放或强制重置。
- 早期 `tests-final.txt` 为旧参数120项通过；`tests-integration.txt` 为合入主线后的157项通过；`tests-final-tuning.txt` 是最终加深前23项通过，不能当作本次最终参数验证。
- 调校期间失败输出 `tests.txt`、`tests-fixed-increment.txt`、`tests-path-bound.txt` 保留。分别暴露重建期间画布读取时序/固定事件等待时长、接近限深后固定增量不可能、早期滑动上限与新参数不符。最终按真实经过时间驱动输入，并独立检查路径深度差及自然归位，未跳过断言。

## 视觉与操作证据

- [桌面鼠标正常速度录屏](../artifacts/issue-25-responsive/desktop-mouse.webm)
- [手机触屏模拟正常速度录屏](../artifacts/issue-25-responsive/mobile-touch.webm)
- [桌面短按](../artifacts/issue-25-responsive/desktop-mouse-short-press.png) / [长按深压](../artifacts/issue-25-responsive/desktop-mouse-full-press.png) / [滑动](../artifacts/issue-25-responsive/desktop-mouse-sliding.png)
- [手机短按](../artifacts/issue-25-responsive/mobile-touch-short-press.png) / [长按深压](../artifacts/issue-25-responsive/mobile-touch-full-press.png) / [滑动](../artifacts/issue-25-responsive/mobile-touch-sliding.png)
- [最终参数及GPU量测](../artifacts/issue-25-responsive/validation.json) / [录制输出](../artifacts/issue-25-responsive/capture.txt)

原交付的昼夜、换色和恢复中重按证据见 Issue #25 原始交付文档；本次不改变灯光。手机仅CDP模拟，尚未真机验证。

## 固定预设、入口、局限与回滚

按用户要求将本版参数固定为正式预设，并在AGENTS.md记录复用与保护规则，与黏土并列。稳定ID仍为 `slow-rebound`，工厂 `src/orb-slow-rebound.mjs`；制作页的黄油慢回弹继续映射该ID，黏土仍为 `clay`。可直接进入 `/squishy/cloud/?style=orb&coreMaterial=butter`。切换材质复用既有实例销毁与新建，不带入旧压痕。

这是径向视觉近似，不宣称真实材料物性。较深长按受局部半径安全限深；稀疏事件不能重建没有输入的折线路径。原始其他样式由主线负责，未扩展慢回弹到它们。

回滚时正常 revert 本PR合并提交并重建，无数据迁移。关联 #25，不自动关闭 #16、#22、#3。
