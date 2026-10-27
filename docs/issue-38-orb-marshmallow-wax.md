# 棉花糖薄蜡制作预览

## 滑动裂缝修复（待用户查验）

七款非圆球的完整支撑模式此前记录了损伤，却错误跳过裂边的实际切向张开，导致滑动有形变、没有可见裂缝。现恢复选中局部裂边的几何张开及 0.0008 安全抬升，再由完整实际芯面约束；完整支撑模式仍不启用整片柔性铰链。黏土和圆球原路径保持不变，内芯参数未修改。

运行包 SHA-256 为 `d8cacbc5cd1f50582c5a8209d336d798754bd1fde508de1636e1a974a17a671c`。`node --test --test-concurrency=1 tests/wax-marshmallow-style-geometry.test.cjs tests/wax-marshmallow-cracks.test.cjs` **14/14 通过、退出码0、102.24秒**，原始输出 `artifacts/issue-38/marshmallow-cracks-final-geometry.txt`。包括真实深按、拖动、破口边缘、恢复及浅滑；浅滑0.3秒时七款均零掉片，真实相邻片边界有220–926组张开，最大切向间隔约0.00738–0.00763。远处未变形的实际表面位置及法线逐值一致。修复前负对照的张开组数为0，见 `marshmallow-visible-cracks-before-fix.txt`。

深按完整几何测量的附着内层最大最近芯面间隔约0.01030，厚度0.014、normal支撑gap0.004，最大厚度误差小于3.5e-7；真实内外面、边和断面穿入违规均为0。下文约0.008的数字是本次裂边重新张开前的历史阶段，不作为当前最大值。

真实原生滑动浏览器验证 `WAX_MM_SLIDE_RECORD=1 node --test --test-concurrency=1 tests/wax-marshmallow-slide-browser.test.cjs` **7/7通过、退出码0、88.64秒**，见 `marshmallow-slide-browser-and-video.txt`。所有样式在真实可信短滑动后有实际裂缝、零掉片，裂缝位置与实际GPU上传误差0；随后真实按住1.8秒掉片、清理和侧转检查均通过。七段正常速度录像为 `<style>-marshmallow-slide-and-fracture.webm`，近景及侧面截图仅作辅助。鼠标事件按CDP原生队列顺序发送，不修改时钟；原先逐条等渲染ACK造成猫爪短滑被拖成长按的失败记录另保留于 `marshmallow-slide-browser-serialized-input-attempt.txt`。

以上为Windows Edge桌面功能及几何验证；不是手机真机或性能验收。棉花糖猫爪在此前性能采集中仍较慢，仍须单独处理。棉花糖改动保留在PR #39草稿，用户查验通过前不合并。黏土发布单独在PR #42处理。

## 当前修复与完整几何结果

当前范围为八款黏土与八款棉花糖制作预览。新增七款使用宿主显式传入的 `fullSurfaceSupport:true`，工厂不绑定内芯质感。完整支撑预建真实内外面、顶点、唯一边中点及断面三角形样点，并通过实际变形芯网格约束；默认已验收的黏土与圆球路径不启用这个额外模式。

非凸折叠处最近点可能落在共享边或顶点，单个三角面法线无法可靠判断内外侧。新模式按[角度加权特征法线方法](https://orbit.dtu.dk/en/publications/signed-distance-computation-using-the-angle-weighted-pseudonormal/)处理边和顶点，最近距离仍由完整真实网格查询取得。八款原始拓扑经重合缝顶点归并后均为闭合二流形（边界／非流形边均为零），见 `feature-normal-topology.json`；这不自动证明任意外部资产或任意自交形态有效。

独立三方向射线奇偶与立体角绕数证明：旧猫爪异常点实际在外侧，旧单面法线却报告 -0.03808787；新判定为 +0.03808787。另一个真实内侧点仍被检出为 -0.00027735，未把负值一律改正。真实 GLB 稀疏变形夹具、源资产哈希、独立射线回归保存在 `tests/fixtures/wax-paw-fold.json`、`tests/wax-feature-normals.test.cjs`；证据为 `paw-fold-independent-inside{,-legacy}.json`。

最终七款测试 **7/7 通过，107.98 秒，退出码 0**，每款 469 个内芯帧与裸芯逐值一致；完整面／边／厚度断面检查全部零穿入违规。所有款式实际内层最大最近芯面间隔不超过约 **0.00800003 模型单位**，厚度仍 **0.014**、normal 支撑 gap 仍 **0.004**，没有用大间隔掩盖穿模。猫爪原误判引发的 0.04235 实际悬空已消除，最大累计局部校正现为 0.00117645，单次 0.00107735。逐款数据和原始命令见 `all-marshmallow-feature-normal-summary.json`、`all-marshmallow-feature-normal-geometry.txt`。

上述是离散几何验证，不是连续时间无交叉证明。浏览器、正常速度录像、性能与用户视觉验收另行登记；真机和 Safari 未验收。先给用户走查，用户明确确认前不合并。

## 接入合同与早期定位记录

用户在圆球交付后进一步授权，将同一 `thin-wax` 预设复用于当前其余七种造型的棉花糖内芯：云朵、猫爪、圆柱、甜甜圈、三角锥、五瓣花朵和五角星；新增范围为八款 `marshmallow × wax × thin` 的制作预览。内芯步骤继续裸芯试捏，外壳／装饰步骤显示真实薄蜡。慢回弹、中／厚蜡、指甲油和糖不启用。现有八款黏土范围保留；本轮不开发最终试捏及托盘承接。此授权范围不等于新增七款几何／性能已验收，逐款结果必须另行登记。

场景复用原 `getOrbFeel('marshmallow')`，没有修改 `src/orb-marshmallow.mjs` 的参数或算法。同一输入同时通知原内芯和独立薄蜡，不新增输入控件。实际连续驻留超过 0.5 秒后局部掉片；内芯仍渐进按入、滑动留浅痕、松手完全保留。内芯／外壳颜色独立，真实壳厚 0.014、normal 支撑间隔 0.004，均为模型单位。

状态入口为 `detail/state.mjs`，场景范围检查在 `src/orb-preview.js`：棉花糖必须属于当前已支持造型且 `waxCollection === false`，不能因放行制作预览而扩展最终体验。原圆球黏土最终体验的条件独立保留。制作步骤同配方往返不重建壳；显式重新开始与真正提交的配方变化创建新状态。进入既有最终体验仍按旧流程恢复内芯，通过 `restore({preserveShell:true})` 保留隐藏的制作壳损伤，返回制作步骤重新应用显示配置。所有棉花糖最终体验均不新增薄蜡重开按钮。

新增七款的几何验证入口为 `tests/wax-marshmallow-style-geometry.test.cjs`。每款读取真实 GLB，按正式场景的 `style.geometryOptions` 分别创建有壳和裸芯的独立 surfaceGeometry，仍调用原棉花糖工厂；逐个 60Hz 内芯 step 比较位置数组、状态与 step 结果。圆球保留原径向专项，不把径向偏移套到其他造型。壳与碎片使用实际 presentation scale；甜甜圈命中内圈，猫爪命中掌趾连接处，并覆盖局部阈值、结构深按、浅滑、重复破口、松手／取消逐值冻结、恢复过程中芯面增长和碎片过期。每阶段穷尽测量实际面、边中部和断面，记录 normal 支撑 gap、最近芯面 signed 距离、厚度误差和局部校正，不能只断言一个“未穿模”状态。初始阈值／滑动使用 60Hz 壳同步，深压段保留全部 60Hz 内芯轨迹对照并采用 0.1 秒壳同步，额外检查延迟渲染情形。

该七款测试首次完整运行的命令为 `node --test --test-concurrency=1 tests/wax-marshmallow-style-geometry.test.cjs`，TEMP／TMP 均为项目内 `.tmp/runtime`，26.31 秒，退出码 1，原始输出保存在 `artifacts/issue-38/all-marshmallow-geometry.txt`。圆柱、三角锥和花朵通过；云朵、猫爪、甜甜圈和五角星在深按后的滑动阶段发现附着壳局部穿入，必须修复后重跑，不能以复用预设直接宣布全部通过。四款的附着违规数分别为 5／1／6／11，最近芯面 signed 最小距离分别为 -0.00023066／-0.00456455／-0.00034682／-0.00408915 模型单位；normal 支撑 gap 仍约 0.004、厚度误差小于 2.3e-7，说明只检查顶点 normal gap 不足以证明真实壳面不穿入。已采集阶段的脱落片违规均为 0。新款结果不沿用下方圆球阶段的通过记录。

可用 `WAX_MARSHMALLOW_GEOMETRY_CASE=paw,donut` 定向检查非凸连接与内圈，再完整运行上述命令。新七款的浏览器／性能仍待验收；猫爪黏土也被用户指出明显卡顿，主 Agent 正单独优化精确查询，不因新增棉花糖而声称猫爪性能合格。

四款失败的进一步定向测量见 `artifacts/issue-38/marshmallow-geometry-sample-diagnostic.txt`：云朵／猫爪／甜甜圈的最差样点均为内层三角形边中点，原始芯 sourceFace 分别为 1360／17348／1676；五角星的最差样点为断面三角形面心，断面两个端点均来自 sourceFace 8530。四者当时 `lift = 0`，不能归因于整片铰链翘起。云朵和五角星的 `complexSurface` 为 false，原最近面校正分支没有覆盖；猫爪和甜甜圈虽然已校正面心／部分断面样点，仍漏掉内层边中点。这些为修复前证据，不能据此宣称修复已完成。`getMetrics().worstAttachedSample` 现包含 `sampleKind`、真实渲染三角形编号及芯面来源，便于复核实际失败位置。

`tests/orb-marshmallow-wax.test.cjs` 对正常／减少动态逐帧比较有壳与裸芯的每个位置、内芯状态和 step 结果；再检查深按、浅滑、重复压破口、松手冻结、显式恢复中的壳芯间隔和实际面／边／断面。专项 3 项通过，记录见 `artifacts/issue-38/orb-marshmallow-wax-geometry.txt`。这属于采样几何验证，不是连续时间无交叉证明。

`tests/orb-marshmallow-flow.test.cjs` 与原状态回归共 20 项通过，记录见 `artifacts/issue-38/orb-marshmallow-flow-state.txt`。专项浏览器 2 项通过，记录见 `artifacts/issue-38/orb-marshmallow-wax-browser.txt`：当前阶段实际首个超过阈值的已渲染帧为 0.5045 秒，3 片分离；原生 GPU 上传与内芯位置误差为 0；裸芯／壳的屏幕框完全相同。松手稳定性从 release 完成的快照起逐值比较，因为原棉花糖 beforeRelease 会先提交尚未完成的最后一次输入，不能将此合法末次输入误判为松手回弹。

上述浏览器阶段运行包 SHA-256 为 `db9f6a361d90d82bdf6cd64da7c739f64d1ee7ac9fbafbb121daf1e8e389b97e`。Windows Edge 桌面功能验证不等于手机真机性能；最终优化运行包及正常速度录像需分别登记。多造型性能诊断见 [性能记录](issue-38-performance.md)，仍需如实保留复杂造型限制。

正常速度录像入口沿用 `scripts/capture-thin-wax.cjs`：设置 `THIN_WAX_CAPTURE_CORE=marshmallow` 并运行 `node scripts/capture-thin-wax.cjs --capture-only`，独立写入 `marshmallow-preview-validation.json` 与 `orb-marshmallow-preview-*`，不覆盖黏土录像。脚本拒绝开启棉花糖托盘录制。

回滚棉花糖接入时，普通提交撤回状态／场景中的棉花糖制作预览范围条件、相关专项测试及文档，再执行 `npm run build:orb`；不修改已确认棉花糖工厂、不删除可复用薄蜡或其他黏土接入。完成提交后在 PR 中登记对应提交号，保留其他协作者成果。
