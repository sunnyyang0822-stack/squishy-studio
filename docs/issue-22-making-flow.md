# Issue #22：捏捏制作流程

本次从明确的 `origin/main` `e6bb15b` 建立独立分支 `codex/issue-22-making-flow`，在独立 worktree 开发。开发期间合并了最新 `origin/main` `4f4ebfe`（PR #23 的黏土阻尼），通过重新构建解决生成包冲突，没有改写共享历史。原工作目录和其他协作者的未跟踪文件未动。

## 页面与交互

- 合集单独展示可制作的奶油圆球，入口携带 `style=orb`；没有模型的云朵样例继续保持“制作中”，没有制作链接。首页 Hero 不变。
- 旧 `/squishy/cloud/`、无尾斜线链接和直接访问均有效；未知样式回退到唯一可用的圆球。
- 五步为内芯、外壳、装饰、制作、试捏。顶部五段箭头条标记当前、已完成和未开始；前进、返回和浏览器历史同步更新。这是步骤进度，不是制作任务百分比。
- 步骤条尺寸紧凑、箭头紧贴；白天采用较浅颜色，夜晚沿用原强调色。内芯按钮为黏土、棉花糖、慢回弹，三个同排。
- 桌面当前步骤的几组设置同时展示；手机的材质、颜色、填充物等分类点击切换，每次只展示一组。外壳分类为颜色、材质、厚度；厚度仅蜡可用。分类切换不重建场景、不更改配方。
- 桌面左大圆球、右原位面板；手机上主体、下设置。色卡统一只有圆形色点，选中圆环为当前色点的加深版，保留中文辅助名称和至少 44×44 CSS 像素触控区域。桌面三组设置的间隙均匀；内芯材质、外壳材质和厚度均为三项同排。
- 产品界面去掉左侧说明、重复步骤标题和解释句。完整步骤标题保留给辅助技术；可见文案保留必要分类、选项、导航和错误提示。
- 制作步骤的动画区域留白，提供返回修改和开始捏捏；没有假进度、计时或动画事件等待。进入时调用已有输入取消机制，结束正在施力的输入。
- 进入最终体验时复用既有换色时钟和形态／姿态恢复流程；同色也可启动该时钟。正常换色的默认行为不变，恢复中仍可由新输入接管。

## 状态与边界

`detail/state.mjs` 集中定义默认配方：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| styleId | orb | 唯一可用样式 |
| coreMaterial | clay | 可选 clay／marshmallow／butter，butter 的显示名称按用户要求为“慢回弹” |
| coreColor | rose | 原十色表，不改 ID、名称或色值 |
| filling | none | none／perlite／rice／burst 单选 |
| shellMaterial | wax | wax／polish／sugar 单选 |
| shellColor | rose | 与内芯颜色独立 |
| waxThickness | medium | thin／medium／thick 是厚度偏好，不解释成层数 |
| decoration | one | one／two／three，显示 1／2／3 |

当前步骤、完整 `recipe`、条件处理后的 `effectiveRecipe`、`preview` 及资源／错误状态分别保存。非蜡的有效配方 `waxThickness=null`，完整配方仍记住偏好。分类展开状态独立存于页面中，不混入用户配方。

三个用户内芯选择均映射实际 `preview.feelId='clay'`，不会改写用户所选材质。第一步预览内芯色；第二、三步和最终体验预览外壳色。最终渲染请求携带当前完整有效配方，包括装饰。

沿用 prepare／commit／dispose、AbortController 和最新请求生效机制；已经应用原色、等待新色时再选回原色，也会取消过期请求。非视觉配置和分类切换不重复创建 Canvas、监听器或动画循环。加载、引擎包失败、WebGL 丢失仍可编辑、前进、返回和重试；离页执行原有清理。

同一页面流程内的前进、后退、返回修改和浏览器前进后退保留最新配方。刷新、重新进入或从已释放的页面缓存恢复会开始新的默认配方，并回到合法第一步；URL 的未知步骤不会产生死页。本轮没有永久保存作品，也没有此类产品文案。

## 效果清单

| 配置／行为 | 本轮实际接入 |
| --- | --- |
| 圆球样式 | 现有真实 GLB、按压、拖动、旋转 |
| 黏土 | 最新已确认手感，直接复用 clay |
| 棉花糖、慢回弹 | 配方选择；实际仍为 clay，没有两套独立手感 |
| 内芯色、外壳色 | 原十种马卡龙颜色、换色覆盖动画及同步恢复；单表面基础预览 |
| 填充物 | 单选配方；没有颗粒、米粒或爆浆视觉／物理 |
| 蜡、指甲油、糖 | 独立配置；没有专属涂覆、透明、碎裂或光学效果 |
| 薄／中／厚 | 条件配置和偏好恢复；没有可见物理厚度 |
| 装饰 1／2／3 | 单选、状态保留、后续配方传递；没有装饰模型、贴图或撒落效果 |
| 制作 | 留白区域和可继续／返回的边界；没有正式制作动画 |
| 最终试捏 | 当前外壳色和完整有效配方、同一 clay 场景、恢复后可继续捏 |
| 音频 | 保留静音适配状态，不增加音源或控件 |

## 验证与证据

实际命令与结果：

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `npm ci` | 安装 19 个包，审计 20 个包，0 漏洞；没有依赖版本迁移 | 0 |
| `npm run build` | 原品牌和圆球构建成功；生成包包含最新黏土阻尼 | 0 |
| `node --test tests/detail.test.cjs` | 7 项流程、条件控件、分类与响应式测试通过 | 0 |
| `node --test tests/orb-browser.test.cjs tests/orb-color.test.cjs tests/orb-day-color.test.cjs tests/orb-interaction.test.cjs tests/orb-rotation.test.cjs tests/toy-colors-motion.test.cjs` | 31 项浏览器回归通过 | 0 |
| `npm test` | 82／82 通过，0 失败、0 跳过，含原构建流程 | 0 |
| `node capture-making.cjs` | 15 张截图、2 段录屏和布局尺寸报告生成成功 | 0 |

[最终完整测试日志](../artifacts/issue-22/tests.txt)保留原输出和退出码。[首次失败日志](../artifacts/issue-22/tests-first-run.txt)保留了减少动态下色卡反馈的失败；通过恢复显式 `transition:none` 修复，没有删除或跳过原约束。旧 4197 端口有其他工作目录服务，日间颜色测试改用空闲的 4217，最终验证使用当前 worktree。

黏土算法、登记和全部黏土回归测试与最新主线相同：`src/orb-deformation.mjs`、`src/orb-feels.mjs`、`tests/orb-deformation.test.cjs`。色表 `detail/orb-colors.mjs` 和 Hero `styles.css` 也保持主线原样。

远端运行 [39707181824](https://github.com/sunnyyang0822-stack/squishy-studio/actions/runs/39707181824) 为 81／82 通过：旋转接管测试的鼠标命令在较慢 CI 上晚于 650ms 恢复区间到达，导致测试没有在预期的中途输入。该测试改为在页面加载前安装 Playwright 时钟，只在两次输入接管边界暂停并推进至真实 GPU 的部分恢复帧；旋转前刻意等待 750ms 主机时间，验证命令延迟不会改变测试前提。原压痕、姿态和颜色断言全部保留，没有修改产品恢复时长、手感或跳过测试。`node --test tests/orb-color.test.cjs` 的 8 项测试通过，退出 0；其他换色测试仍使用自然运行时钟。

Windows Edge 155 自动化覆盖真实 WebGL 缓冲、局部形变、换色和姿态恢复、输入取消、失焦、后台、离页释放、模型／引擎失败、重试、昼夜、键盘、减少动态、多点触摸和原生滚动。测试覆盖 1440×900、390×844、375×667、320×568、844×390，以及动态高度和横竖屏切换。

手机三种分类在 390×844、375×667、320×568 均验证一屏可访问。极短 390×450 专门验证主体触摸和必要的页面滚动共存；横屏面板通过内部滚动保留全部选项和导航。[布局报告](../artifacts/issue-22/visual-check.json)记录真实视口、文档、主体和面板尺寸。

**真机范围：本轮未连接实体 iOS／Android 手机。** 手机视口、触屏和多点事件来自 Playwright／CDP 仿真；不能替代真机浏览器工具栏、安全区和手指操作验收。

| 截图 | 白天 | 夜晚 |
| --- | --- | --- |
| 桌面颜色 | [查看](../artifacts/issue-22/desktop-day.png) | [查看](../artifacts/issue-22/desktop-night.png) |
| 手机颜色 | [查看](../artifacts/issue-22/mobile-day.png) | [查看](../artifacts/issue-22/mobile-night.png) |
| 手机材质 | [查看](../artifacts/issue-22/mobile-material-day.png) | [查看](../artifacts/issue-22/mobile-material-night.png) |
| 小尺寸手机 | [查看](../artifacts/issue-22/small-day.png) | [查看](../artifacts/issue-22/small-night.png) |
| 横屏 | [查看](../artifacts/issue-22/landscape-day.png) | [查看](../artifacts/issue-22/landscape-night.png) |

流程截图：[外壳](../artifacts/issue-22/desktop-shell.png)、[装饰](../artifacts/issue-22/desktop-decoration.png)、[制作留白](../artifacts/issue-22/desktop-making.png)、[最终体验](../artifacts/issue-22/desktop-play.png)。

[珊瑚红选中圆环](../artifacts/issue-22/desktop-coral.png)；十种颜色的圆环在昼夜均验证为当前色的加深版，色点本身仍使用原色表。

录屏：[第一步试捏、旋转和连续换色](../artifacts/issue-22/core-squeeze-color.webm)；[从选样式到最终试捏](../artifacts/issue-22/full-flow.webm)。两段均为真实浏览器操作录制，不含正式制作动画。

## 风险与回滚

剩余风险是实体手机尚未验证、单表面无法同时呈现内外两层，以及配置型选择尚未有独立资产或物理效果。刷新会重置本次配方。本次没有作品保存系统、账号、支付、部署、真实填充、装饰或新手感。

回滚时撤销本 PR 的功能提交并重新构建，保留主线已合入的 PR #23 黏土阻尼；不要回滚上游合并或改写共享历史。没有数据迁移。关联 #22，#3／#10／#16 不使用自动关闭关键字。
