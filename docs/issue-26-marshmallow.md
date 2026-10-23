# Issue #26：独立棉花糖

2026-10-22，从远端 `origin/main` **959a71901f8f55fb484e6b6ea3578b7969434ed4** 建立 `codex/issue-26-marshmallow`，工作树 `D:/squishy-studio-issue-26`。未操作原工作区中慢回弹执行者的未提交实现、文档或生成文件。此基线的正式制作流程已存在，但没有登记 `slow-rebound` 或其源文件/测试；本次保留 butter 原有 clay 映射，不引入或调整本地慢回弹。关联 #26；#16、#22、#25、#3 保持独立范围。

## 慢帧过程保护

最终CI进一步发现慢帧下逐帧增深超限，因step曾直接积分全部elapsed。现棉花糖单帧积分上限40ms，正常30–120Hz不变；卡帧后不补算整段按压，低帧率设备以实际呈现帧渐进。新增step(2)/step(3)测试，首帧和第二帧仍浅且连续；释放step(10)仍完全冻结。低于25fps时达到同一深度需要更长真实时间，这是保留可见过程的取舍。黏土、慢回弹不受影响。

## 当前走查修订：渐进按压，安全边界与单次深度分开

基于 origin/main 1976819e4258c519b289d76054d728f4b9a70370，独立分支 codex/issue-26-progressive-press。用户明确指出上一版 .70 固定目标配合360/s响应过快过深。本修订保留 .70 / 径向76% 的安全边界，但不再将它作为单次按压目标。以下为当前规则；后面两次交付的参数均为历史对照。

- 每次 begin 保存当前 retained，不恢复原球。强度从 .03 开始，2秒线性增至 .61；单次目标为 retained + (limit-retained) * (1-exp(-strength*envelope/limit))，limit=min(.70, radius*.76)。剩余空间越少，新的按压可深入量越少。
- 静止按压响应8/s（黏土5/s），通过已有 step 循环单调逼近不断加深的目标。首个60Hz帧约 .004，而非上一版 .697；100ms约 .025、300ms约 .077、1秒约 .233、3秒约 .407。单次无限长按的上界约 .407，低于 .70 安全边界；多次刻意按压可以继续深入，小核心边界保留。
- 指针相对本次按压起点移动超过 .02 模型单位才启用轨迹跟随240/s；轨迹目标仍受上述2秒压力进程约束。此处快速跟随用于稀疏路径连续性，不将深度设为安全上限。静止的高密度事件和微小抖动不能将按压加速。无顶点在 begin/move 中瞬移；step(0) 不改几何，压力增长期间持续请求帧。
- 当前路径包络仍按最大影响取值，折返/事件数不会作为增深次数。只有 release 后新的 begin 才开启下一次逐步按压。释放和取消原样冻结；reset、换色显式恢复与中断接管不变。减少动态保留直接操作所需的按压过程。
- 光学材质、黏土源代码与回归约束没有改动，没有新纹理、绘制通道或模型。

真实GLB的曲线、顶点坐标和108组轨迹见 [geometry.json](../artifacts/issue-26/progressive/geometry.json)。100ms/60Hz/12事件的起、中、终点约 .056285/.056423/.055817；全部轨迹最大九点差 .055457，继续小于原 .065 容差，释放后10秒漂移为0。更长按压比黏土略快（1秒 .233 对 .141，3秒 .407 对 .369），短按深度从上一版 .699 降至 .025（100ms）。

新增逐帧分阶段、单次长按不到底、再次按压连续接管、不同帧率/静止事件密度/微抖动、减少动态、重复按压小核心安全测试。原黏土测试未删除、弱化或跳过。最终整合包含 origin/main aa78cc1（慢回弹 #27、样式大厅 #31）。合并冲突仅为生成的 assets/orb-preview.js，已用合并源码重建；src/orb-deformation.mjs、src/orb-slow-rebound.mjs 和黏土回归测试与该基线一致。修正测试计时后，整合前 npm test 为92/92、exit 0（concurrency-two-tests.txt）。整合后普通端口运行114/117，3项慢回弹测试因另一个执行者的4205预览服务占用而超时；独立14205端口首项复查通过。最终完整端口隔离命令为 TEST_PORT_OFFSET=14000 node scripts/test-port-isolated.cjs，日志 integrated-isolated-tests.txt，原始断言不变，最终117/117通过、0失败/跳过、exit 0。全部临时副本由该主线脚本自动删除，不提交。

最终录屏的真实GPU逐帧记录：桌面134帧，最大单帧增深 .009107；模拟手机154帧，最大单帧增深 .013590。实际短按分别约60ms和84ms。它们均经历渐进变化，单次长按深度低于 .50；释放静止、取消及换色恢复/接管通过。browser.json 包含实际按下时间、首/末帧和采样时刻；固定时间比较仍以独立GLB曲线为准。

首轮GitHub完整检查91/92：名义45ms短按实际调度815ms，固定短按阈值误判。测试现记录真实pointerdown/up时长并据此约束深度，同时观察实际GPU逐帧变化（首帧不得到底、帧间增量受限、至少3帧且持续加深），严格固定时长仍由真实网格测试约束。npm test限制并发为2，完整测试范围不变。

本地 node --test --test-concurrency=1 tests/*.test.cjs 为89/92，3项昼夜GPU测试因共用4217端口服务超时/拒绝连接失败（exit 1）；仅将该测试文件端口替换为14217的临时副本复查4/4通过（exit 0），断言无修改，副本运行后删除。最初并行全套因资源竞争中止，日志保留，未计为通过。完整验证与证据位于 artifacts/issue-26/progressive/，录屏保持正常速度，新增名义等待100/300/600/1200ms的浏览器阶段截图；截图/录制会增加驻留，browser.json同时记录实际pointerdown到采样的elapsedMilliseconds，固定时长曲线以真实网格测试为准。手机为CDP模拟，未验证真机。持续按压比之前需要更多活动帧，剩余空间软限制每顶点新增一次指数计算；没有新增绘制或纹理成本，但未量测真机CPU耗时。释放后仍停帧。回滚本修订PR并重新构建可恢复上一版快速到底的参数，不涉及数据迁移。

## 走查反馈修订：更深的塌陷

2026-10-22，基于 origin/main 3154a0791214bc4bac90bd3073f55635884741e9 的独立分支 codex/issue-26-deeper-marshmallow。用户反馈旧版中心过大、过早捏不动。本修订将绝对深度上限由 .28 提升至 .70，径向安全上限由42%提高至76%（至少保留24%半径）；响应由180/s调整为360/s，时间常数2.78ms。足迹、路径采样、保持与恢复规则不变，黏土没有修改。

真实 GLB 正面最近顶点：16.67ms 深度 .697283，50ms 稳定深度 .699016，原版本稳定深度 .279606。前侧中心剩余半径约 .30；40次重复按压不进一步挖穿。108组轨迹的最大九点深度差 .036492，继续满足原 .065 容差，松手后10秒漂移全部为0。多方向30轮揉压逐三角面检查朝外绕序，未出现翻面。更深凹陷会产生更强的侧壁阴影，依然保留安全中心，不支持完全压扁至零体积。

当前参数和测量见 [新几何报告](../artifacts/issue-26/deeper-geometry.json)，[完整本地验证](../artifacts/issue-26/deeper-tests.txt) 与 [退出码](../artifacts/issue-26/deeper-tests-exit.txt)。新截图和正常速度录屏位于 artifacts/issue-26/deeper/；手机仍为CDP模拟，未验证真机。回滚本修订PR即可恢复 .28 深度版本。

以下为首次交付的历史参数、测量和证据，保留用于对照，当前参数以本节为准。

## 调用与边界

```js
const feel = getOrbFeel('marshmallow');
const deformation = feel.createDeformation(positions, normals, { reducedMotion });
// 也可直接 createOrbPreview(mount, { feelId: 'marshmallow' })。
```

工厂 `src/orb-marshmallow.mjs` 独立持有 rest、offsets、retained、envelope、restoreOffsets、径向方向/上限及交互时钟。输入、网格、命中、旋转、换色、恢复时钟、清理和渲染循环继续使用原场景；只复用黏土的圆面路径采样数学思路。黏土工厂和 `tests/orb-deformation.test.cjs` 未修改。

接口完整保留 begin、move、release、cancel、reset、beginRestore、applyRestore、interruptRestore、setReducedMotion、getState、step。begin/move 不改顶点；step 才更新几何。`needsFrame` 与是否有压痕分开：活动形变收敛后和释放后的静态压痕不请求帧；有压痕时 `atRest=false` 沿用场景的“是否可恢复原始法线”语义，不能将停止渲染误当作原球。新输入重新唤醒。

## 响应和保持规则

- 每个受影响顶点目标：`max(strokeStartOffset, min(.28, radius * .42) * pathEnvelope)`。路径足迹半径 .66，核为 `(1-q²)²`，球面插值间隔不超过 .04。
- 一阶单调响应 `1-exp(-180*dt)`，时间常数 5.56ms，约 16.64ms 达到目标的95%。无速度弹簧、过冲、卸载动作或外凸唇边；不是实测材料模型。
- 单次和多次操作都取绝对最大包络，不叠加“按压次数”。顶点最多压入 .28，且不超过自身径向长度42%；保留正半径。真实 GLB 每个三角形的朝外绕序经过多方向揉压验证。
- release/cancel 将当前 offset 原样保留，清除施力包络；之后不继续加深、不回弹。pointercancel、Escape、失焦、后台沿用原输入协调，全部保留当前形态。
- reset 立即清空；换色/显式 restore 由已有颜色时钟驱动 `offset = snapshot*(1-progress)^3`。未收到进度时不自行恢复。新输入使旧恢复进度失效，接管当前可见形态。
- 减少动态下按压同样单调快速，无自动运动；显式颜色恢复继续使用原 .12s，正常 .65s。没有额外 idle 恢复。

真实资产最近顶点，接触点 `[0,.0175,1]`，120Hz解析指数积分；单位为模型坐标，不是毫秒性能跑分：

| 按压时长 | 黏土深度 | 棉花糖深度 |
| --- | ---: | ---: |
| 4ms | .000488 | .143507 |
| 8.33ms | .001005 | .217218 |
| 16.67ms | .001969 | .265686 |
| 25ms | .002894 | .276500 |
| 50ms | .005448 | .279572 |
| 100ms | .009691 | .279606 |
| 500ms | .060372 | .279606 |
| 3s | .368559 | .279606 |

短于一个显示帧的曲线点是解析积分结果；不声称屏幕实际呈现了4ms帧。指数响应没有数学瞬移，但60Hz下首帧即接近目标，这是本次快速塌陷的设计选择。相比黏土，长按不会持续挖深。

## 轨迹几何测量

路径 `p(a)=[sin(a),.0175,cos(a)]`，a 从 -1 到 1，测量 a=-1,-.75,-.5,-.25,0,.25,.5,.75,1 的最近原始 GLB 顶点。JSON 包含顶点索引、实际 rest 坐标、位移、释放后10秒漂移。108组覆盖 .1/.6/2s、30/60/120Hz、2/12/60个事件，以及两端各驻留0/.3s。跨事件密度/帧率同位置深度绝对差容差 .065，沿途9点最大差容差 .065；不是只比状态标志。

| 60Hz、12事件 | 起点 | 中点 | 终点 |
| --- | ---: | ---: | ---: |
| .1s，无驻留 | .278895 | .279606 | .271688 |
| .6s，无驻留 | .278895 | .279606 | .276719 |
| 2s，无驻留 | .278895 | .279606 | .276719 |
| 任一时长，两端各 .3s | .278895 | .279606 | .278895 |

最极端2事件/120Hz/末帧即释放：起点 .278895、中点 .279606、终点 .216665，9点最大差 **.062941**（最大深度的约22.5%）。这是稀疏末事件只有一帧载荷的明确局限；没有在 release 补假深坑。通常12事件/60Hz快划9点差 .007919。所有108组释放后10秒逐坐标漂移 **0**。中段没有“两头重、中间无痕”的问题；采样网格本身使中段可能略深，典型差不足 .001。

折返、跨方向交叉、重复经过15轮及六方向30轮另有几何检查，所有顶点有限、深度有界、真实三角形绕序不反转。稀疏路径会在收到事件后的下一渲染帧补齐，无法推断两个事件之间未知的转折；不引入长时间补痕或释放后补痕。

完整数据：[geometry.json](../artifacts/issue-26/geometry.json)。复现：`node capture-marshmallow.cjs`。

## 本地验证记录

| 命令 | 结果 | 退出码 |
| --- | --- | ---: |
| `npm ci` | 安装19包，审计0漏洞 | 0 |
| `node --test tests/orb-marshmallow.test.cjs` | 最终6/6，含真实三角形绕序、108组曲线与光学隔离 | 0 |
| `node capture-marshmallow.cjs` | 两段录屏、12张昼夜截图、真实GPU断言全部通过 | 0 |
| `impeccable.cmd detect --json src/orb-preview.js detail/adapters.js detail/state.mjs` | `[]` | 0 |
| `npm test`（包含构建） | 最终89/89，失败0，跳过0 | 0 |
| `git diff --check` | 无空白错误 | 0 |

首轮旧范围86/86通过；扩展全套后88/89，已有响应式测试在setViewportSize后立即检查分类栏可见性失败。为媒体查询更新增加明确 `waitFor({state:'visible'})`，仍断言分类、选择及布局全部正确，未改页面逻辑或黏土约束。保留 [失败日志](../artifacts/issue-26/tests-initial-full.txt) 与最终 [89/89日志](../artifacts/issue-26/tests.txt)。这次修改不是删除、跳过或减弱既有回归。再次并发测试发现45ms名义短按可先于宿主机首个rAF结束；保留 [首帧延迟日志](../artifacts/issue-26/tests-concurrent-first-frame.txt)。浏览器短按改为名义等待45ms后确认首个实际压陷帧并记录真实输入时长，固定时间响应仍由独立GLB测试约束；产品代码不改。桌面取消明确聚焦交互面后发Escape并断言已结束施力，触屏使用原生CDP touchCancel。

## 独立光学与制作流程

`src/orb-optics.mjs` 克隆调用者材质。clay 保持 roughness=.82、metalness=0；棉花糖使用独立 MeshPhysicalMaterial，roughness=1、白色微纤维 sheen=.8、sheenRoughness=1、envMapIntensity=.35，复用原色卡顶点色和完全相同灯光。宽而克制的掠射高光配合更柔软的漫反射区别于黏土；不加透明度、金属、噪点、纹理、轮廓位移或模型。预设不依赖形变工厂，场景销毁释放材质，源材质和其他实例参数不受影响。

仍为单球单绘制通道、原环境贴图与静态阴影。sheen 增加片元 ALU 成本，没有新纹理带宽或额外绘制通道；没有实测真机 GPU 时间或温升。形变状态约8个Float32标量/顶点，2562顶点约82KB，加原始 positions 快照约31KB；原有法线重算只在几何变化时运行。按压收敛及静态压痕停帧。引擎打包643,849字节，模型仍124,324字节，无新依赖。

`detail/state.mjs` 将 coreMaterial=marshmallow 映射至独立ID，后续外壳/装饰/试捏沿用；缓存比较包含 feelId，同色切质感也生效。`detail/adapters.js` 切质感销毁旧 renderer/实例，原色更换仍复用场景。辅助技术提示明确“松开完全保留，换色可复原”。其他流程内容和布局不改。

## 浏览器证据与限制

Windows、Edge/Chromium 155.0.4283.62，桌面1440×900，手机390×844（CDP原生触摸模拟，**无真机验证**）。实际 GPU buffer 观察确认短按、长按、起点驻留→滑动→终点驻留、快划、长划、折返、取消/失焦/后台、换色恢复和中断接管；释放等待后每个顶点完全一致。保留着色/颜色独立完成的帧，完成后检查 renderCount 停止。切换质感丢失旧WebGL上下文，换色保持上下文计数，跨步骤最终仍是棉花糖，离页释放全部上下文。0 pageerror/着色器错误。

- 正常速度、未剪去松手等待：[桌面25.32s](../artifacts/issue-26/desktop.webm)、[手机触摸24.00s](../artifacts/issue-26/mobile-touch.webm)。包含实际77ms桌面/82ms触摸短按、1.2s长按后2.2s等待、两端各350ms驻留、快划/长划/折返以及取消与显式换色。自动化调度会影响实际事件时间，录屏不作为严格等时曲线。
- 桌面同条件：白天 [黏土](../artifacts/issue-26/desktop-clay-day.png) / [棉花糖](../artifacts/issue-26/desktop-marshmallow-day.png)，夜间 [黏土](../artifacts/issue-26/desktop-clay-night.png) / [棉花糖](../artifacts/issue-26/desktop-marshmallow-night.png)。
- 手机同条件：白天 [黏土](../artifacts/issue-26/mobile-touch-clay-day.png) / [棉花糖](../artifacts/issue-26/mobile-touch-marshmallow-day.png)，夜间 [黏土](../artifacts/issue-26/mobile-touch-clay-night.png) / [棉花糖](../artifacts/issue-26/mobile-touch-marshmallow-night.png)。
- 留痕：桌面 [昼](../artifacts/issue-26/desktop-dents-day.png) / [夜](../artifacts/issue-26/desktop-dents-night.png)，手机 [昼](../artifacts/issue-26/mobile-touch-dents-day.png) / [夜](../artifacts/issue-26/mobile-touch-dents-night.png)。另实际抽查两段视频8秒帧，并非用截图替代释放后的几何检查。
- [浏览器数值](../artifacts/issue-26/browser.json)、[capture输出](../artifacts/issue-26/capture.txt)、[完整测试输出](../artifacts/issue-26/tests.txt)。

未验证 Safari、Firefox、真实手机性能和触觉体验；使用既有近球形GLB，任意非凸/多部件模型需另验尺度与径向约束。远端基线没有慢回弹测试，因此不能声称验证了未合并的慢回弹分支。revert 本次提交并运行 `npm run build` 即回滚，不涉及数据迁移；应使用普通回滚PR，不改写共享历史。

CI最终改为串行运行完整测试，避免GPU竞争导致短动画采样错过。棉花糖显式恢复测试在实际首个恢复顶点上传事件内通过键盘直接接管，逐顶点验证接管前后相同、该帧深度非零、输入已接受，再验证释放保持。保留原换色/黏土断言。产品参数不变。
