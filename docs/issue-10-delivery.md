# 捏捏详情页 UI 阶段交付 · 关联 #10

## 基线与范围

从 `origin/main` 的 `d9cda7c054949d2d3af8a7e40ec64edb0c2c0922` 创建 `codex/squishy-detail-ui`。沿用原生 HTML/CSS/JavaScript、Three.js 与 Node 静态服务，不新增依赖，不改首页 Hero 的 HTML、CSS、字标或切换脚本。大厅只增加一个预览链接，原合集仍为「制作中」。

访问 `/squishy/cloud/`（无尾斜线自动重定向），直接打开、刷新均有效。顶部返回合集大厅，主题在样式加载前沿用既有 localStorage 偏好；存储不可用时沿用原有降级行为。本页不另建一套主题系统。

## 已完成与待接入

| 项目 | 本轮状态 |
| --- | --- |
| 页面与响应式 | 大主体、底部紧凑设置、独立音量面板；手机和短屏自然滚动 |
| 外观 | 项目原创静态奶油小云 SVG，连续曲面渐变与柔和阴影；明确「外观预览」 |
| 配置 | 薄／中／厚 × 蜡／指甲油／糖；默认中＋蜡；独立单选；底部只保留按钮，中文摘要仅供辅助技术读取 |
| 资源 | 实际图片加载、就绪、失败、重试和渲染不可用；无假延时和百分比 |
| 音量 | 初始静音、0–100%、首次解除50%、恢复最近非零值；仅设置偏好 |
| 正式 GLB、局部捏压、脆皮 | 待后续接入；当前不模拟、也不通过缩放冒充厚度 |
| ASMR 与材质差异 | 待参考核实与正式音源；无播放、合成音或成功播放反馈 |

已实际通过浏览器查看 [Wax Ball](https://theasmrworld.com/waxball) 中央大主体、底部小控件的比例；只借鉴布局关系。正常访问 Issue 的小红书入口仍返回安全限制、错误码300012；未观看视频，不宣称验证过三种材质的破裂、光泽或声音差异。参考网页截图仅作本地观察，不作为本站资源或提交资产。

## 状态与接入接口

- `detail/state.mjs` 导出 `createDetailController({ renderer, audio, onChange })`。快照分开提供 `resource`、`config/configStatus/configError`、`audio`；`select(group,value)` 接收完整有效配置，同值不重建。页面广播即时选择，异步准备采用版本号与 AbortSignal，过期成功会销毁，过期失败不覆盖当前状态。
- 渲染器 `prepare({ thickness,material }, { signal })` 必须在私有容器准备资源，返回 `{ commit(), dispose() }`；只有最新结果能 `commit()`。返回null或抛出code为`UNAVAILABLE`的错误表示不可用；其他错误表示失败。当前适配器加载真实 SVG，选项只更新配置，不伪造材质外观。
- 后续 GLB 渲染只挂载 `.toy-mount`，不接触首页 Canvas。`dispose()` 清理场景、材质、纹理与事件，异步任务应尊重 signal。配置失败时保留原可用预览与新选择，显示真实失败提示。
- 音频适配器提供 `ready`、`setVolume({ volume,muted })`、`dispose()`。volume为归一化0–1的主音量，静音时传0；当前 `createSilentAudio()` 不建立 AudioContext，也不请求音源，ready一直false。接口测试验证参数传递，不是音质测试。
- `pagehide` 中取消未完成加载、销毁渲染与音频适配器，移除页面事件。bfcache恢复时重新初始化，避免使用已销毁的未来连接；配置与音量默认不跨详情页会话保存。
- GLB优先规划 `public/models/`，但当前静态根仍为仓库根；未来必须明确实际URL与静态映射，新增 `.glb` 的 `model/gltf-binary` 类型并核验文件字节。此阶段没有伪造public映射或模型文件。

音量面板为非模态区域：打开聚焦滑杆，Esc或关闭按钮返回入口，焦点移出与外部点击关闭但不抢回焦点。桌面靠侧边，小屏进入正常文档流，避免覆盖玩具；滑杆沿用原生键盘与触屏行为。

## 验证与证据

本地 Windows Edge、Node v24.21.0、npm11.19.0；CI使用Node22与Chromium。自动化触屏属于浏览器模拟，本轮未获得实体手机实测。

- `npm ci`：退出0，安装19个包，审计0漏洞；npm提示esbuild安装脚本的allowScripts覆盖警告，安装正常完成。
- `npm test`（包含自动执行的 `npm run build:brand`）：见提交中的 `artifacts/issue-10/tests.txt`，完整保留输出及退出码。保留原有16项测试，新增配置、异步、音量及详情浏览器覆盖。
- `npm run capture:detail`：五种视口的昼夜截图、音量面板、资源失败、实际配置和音量操作录屏；同时以独立origin/main工作目录在同环境重新捕获Hero，与交付页比较。结果见 `visual-check.json`。
- 视口：1440×900、390×844、375×667、320×568、844×390。检查无水平溢出、控件≥44px、设置在主体下方且至少36px间隔、桌面设置靠底、面板不遮挡、键盘焦点、减少动态、主题跨页和刷新。

截图：`artifacts/issue-10/detail-{desktop,mobile,compact,short,landscape}-{day,night}.png`。手机截图为完整文档，以呈现短屏自然滚动；桌面截图为1440×900。面板为`volume-*.png`，失败为`resource-failure.png`，录屏为`detail-walkthrough.webm`。Hero前后图为`hero-{before,after}-{desktop,mobile}-{day,night}.png`。

本地运行：`npm start`，浏览器打开 `http://127.0.0.1:4173/squishy/cloud/`。录屏展示从大厅进入、厚度和材质切换、音量拖动、静音与恢复、Esc关闭、返回以及通过首页切换夜间后再次进入。

重新捕获对照时，从上述基线建立独立工作目录，以4182端口运行其`server.mjs`，将 `BASELINE_URL=http://127.0.0.1:4182`、`PREVIEW_URL`设为当前预览地址，再执行`npm run capture:detail`。不要以不同系统／过渡尚未结束的图作为严格像素基准。

## 风险与回滚

本轮是Issue #10的UI阶段，不能替代正式GLB、材质行为、物理、音频与性能验收；Issue保持打开。源文件、测试、原创资源和证据都在同一提交，可在main上通过新的revert提交回滚本交付或其合并提交，不改写共享历史。无公开部署、无凭据、无无关目录清理。
