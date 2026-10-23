# 首页第二屏样式直达制作

基线：origin/main aa78cc164885917581ca353ee97612211f00f863。独立分支 codex/home-sample-style-links。关联 #8、#30，按用户新要求把原只读样例改为制作入口，不关闭更大范围 Issue。

用户明确要求多子 agent 并行：一位负责第二屏 HTML/CSS，一位负责受影响测试，一位只读审核；主代理集成、浏览器截图、提交与 GitHub 交付。

## 范围

- 使用已有 assets/style-thumbnails 的云朵、猫爪、甜甜圈、花朵，不含圆球，无新增造型资产或模型。
- 图片与名称整块可点击，原生链接支持键盘、触屏和浏览器后退。真实链接为 /squishy/cloud/?style=orb&preview=对应ID，进入现有五步制作。
- 保留既有“新造型准备中／圆球代体验”说明和去合集大厅入口。夜间素材保持原色。
- Hero 源码、主题参数、品牌材质、模型、配方、黏土及其他手感均未修改。仅第二屏四样例与局部反馈变化。
- 精细指针轻抬4px/180ms，键盘即时焦点、减少动态无位移；不阻塞导航。

## 验证与证据

npm ci、npm run build 均退出0。现有受影响的 showcase、hero、style-gallery、toy-colors-motion 四个测试文件全部运行；本地多工作目录隔离端口+2000，断言不变。首次色彩像素fixture清零旋转时被新增180ms过渡影响，修正fixture为同时禁用transition以稳定取样，未放宽像素断言。

截图和录屏脚本：node capture-home-samples.cjs（默认本地4202）。证据目录 artifacts/home-sample-links；含1440×900、390×844、375×667、320×568、844×390第二屏昼夜截图，桌面手机Hero、四入口制作录屏。触屏为浏览器模拟，非实体机。

## 运行与回滚

npm start 后访问 /#samples。本次走查 http://127.0.0.1:4202/#samples 。新造型仍是静态示意，进入使用现有圆球，不承诺对应模型已完成。回滚用新的 revert 提交撤销本次合并，不改写历史。

最终本地结果：四文件25/25通过，0失败/0跳过，退出0（55.5秒），日志见 artifacts/home-sample-links/tests.txt。四张图片中心真实鼠标点击全部通过。构建退出0。GitHub CI继续使用原npm test完整验证。
