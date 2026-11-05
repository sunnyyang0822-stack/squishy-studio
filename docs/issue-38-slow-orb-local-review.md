# 慢回弹圆球薄蜡：已通过用户审核

用户已明确批准慢回弹圆球薄蜡及其与黏土／棉花糖完全一致的比例，可以提交合并，并在后续阶段接入其他慢回弹样式。当前目录为独立工作树 `D:\squishy-studio\.worktrees\issue-38-slow-orb-review`，分支 `codex/issue-38-slow-orb-review`；本提交仅启用慢回弹圆球，其他慢回弹外壳仍不启用。开发起点为d3aa0d0，随后普通快进同步已批准的c8b6889，不改写历史；合并main前仍须完整远端检查通过。

制作配方仍为 `coreMaterial:'butter'` → `getOrbFeel('slow-rebound')`，外观 `full-matte`；仅 `styleId:'orb'` 的 `wax × thin` 制作预览启用。默认中蜡、厚蜡、其他材质、其他慢回弹造型、所有慢回弹最终试捏保持原行为。裸芯与外壳步骤屏幕位置／大小相等，制作预览不显示托盘。

内芯和壳使用原单输入、同一接触点，没有新增Pointer Capture或独立事件控件。内芯阻力、渐进压入、滑动半径与限深、.8/s自然恢复及减少动态模式均未修改；真实壳厚0.014模型单位，normal支撑间隙0.004，实际连续驻留超过0.5秒后局部碎裂，圆球总片预算180、活动24。附着壳逐帧从正在变形／恢复的实际内芯支撑，脱落片独立使用世界重力及芯碰撞。松开后不再增加损伤，内芯完整慢恢复，已有裂纹和破口保留。同配方前后导航保留损伤；主动换配置或重新开始按既有规则重建。最终试捏隐藏预览壳，保留其损伤供返回制作使用。

## 本地验证

当前统一比例运行包 SHA-256 `ccb686000d65dbeef9ff7fd7c2f2306242cd30482914119be2f26803a946138f`。所有TEMP/TMP与浏览器临时目录均在本工作树`.tmp`。用户要求去掉旧full-matte额外的Y×1.06、Z×1.10展示缩放，现为[1,1,1]，光学增益.94及手感工厂不变。当前独立几何／原慢回弹／全模型核心回归36/36通过、退出码0，见 `slow-orb-aligned-geometry.txt`；当前浏览器／正常速度录像及三质感实际模型矩阵与屏幕框对齐3/3通过、退出码0，41.92秒，见 `slow-orb-aligned-browser-video.txt`。桌面、手机裸芯／薄蜡三质感框差小于0.02px，实际GPU变换误差小于1e-6。原十色昼夜光学浏览器回归1/1通过、退出码0，18.44秒，见 `slow-orb-aligned-color-optics.txt`。

以下为统一比例前的接入定位阶段，运行包 `3bd679c02f643505eeec376aa5bcb4d80ac33ee66ee0c007416ea0bf2cf8dd14`。原始输出保留；同名正常速度录像已更新为当前ccb686包，不把旧3bd数据当成当前录像的验证数据。

- `node --test --test-concurrency=1 tests/orb-slow-rebound-wax.test.cjs tests/orb-marshmallow-flow.test.cjs tests/detail-state.test.cjs`：22/22通过，退出码0，7.89秒，原始输出 `artifacts/issue-38/slow-orb-local-geometry-state.txt`。正常及减少动态模式逐帧对照有壳／裸芯完整位置、状态与step结果；正常1048帧，覆盖深压、自然完整回弹、快速滑动、取消、重复破口及重开。真实面／边／断面几何均零穿入，normal间隙约0.004，厚度误差小于2.3e-7，容差1e-5。原芯三个工厂文件没有改动。
- `node --test tests/orb-slow-rebound-wax-flow.test.cjs tests/orb-shell-input.test.cjs`：3/3通过，退出码0，范围枚举覆盖全部8款但仅慢回弹圆球启用；同配方导航、颜色隔离、重开及最终试捏隐藏壳保持损伤，命中丢失结束施力。
- `SLOW_WAX_RECORD=1 node --test --test-concurrency=1 tests/orb-slow-rebound-wax-browser.test.cjs`：桌面鼠标／白天与390×844触屏模拟／夜间2/2通过，退出码0，38.77秒。正常速度录像 `slow-orb-desktop-day.webm` 与 `slow-orb-mobile-night.webm`，真实短按裂缝、首次跨0.5秒掉片、1.5秒深按、松开自然回弹、侧转、永久破口、导航及重新开始。桌面首个碎裂帧0.5016秒，深按位移约0.453，恢复350ms后约0.303，最后精确0；GPU壳位置误差0。触屏旋转使用鼠标辅助，截图仅辅助检查。早期一次错误导航选择器的录制已中断，保留 `slow-orb-local-browser-selector-attempt.txt`，最终运行改用现有`.step-back`入口。
- `node --test --test-name-pattern='style wax scope' tests/wax-style-browser.test.cjs`：1/1通过，退出码0，14.66秒；真实浏览器逐项验证全部慢回弹造型仅圆球制作预览启用，并检查原黏土／棉花糖最终试捏范围不扩展。

独立性能：设置THIN_WAX_BENCHMARK_URL指向4381慢回弹圆球制作预览，运行 `node scripts/benchmark-thin-wax.cjs artifacts/issue-38/slow-orb-local-performance.json`，退出码0。实际服务包与本地哈希相等；Intel UHD／ANGLE D3D11、Windows Edge、390×844桌面触屏模拟，全新配方真实按住4秒，672个完整间隔中位5.6ms、P95 8.5ms、最大43.6ms，原始间隔全部保留。采集时无其他本任务CPU／浏览器测试、录像或profiler并发；未验证真机或Safari，不把桌面成绩当真机帧率。

当前ccb686独立性能记录 `slow-orb-aligned-performance.json`／TXT，命令同上：668个完整间隔中位5.7ms、P95 8.6ms、最大12ms，退出码0，无并发本任务测试或录屏，实际服务哈希相等。前述5.6ms为旧比例包的历史阶段，不混用。未验证真机和Safari。

走查：`http://127.0.0.1:4381/squishy/cloud/?style=orb&coreMaterial=butter&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell`。普通revert本提交并 `npm run build:orb` 可撤回圆球入口与展示比例变更；不修改慢回弹工厂或已批准薄蜡预设，不直接推送main、不强推、不自动关闭#38。

## CI 观察器与软件光栅配置修正

首次PR45运行40517275336的两项分片失败：旧托盘自由落体测试在约140ms的软件渲染间隔中只得到一个完全离开内芯、尚未进托盘的帧；新圆球短按测试未读取现有THIN_WAX_TEST_DPR，且原观察器等到超过0.001才结束，而慢回弹首帧约0.00052，需要额外一帧等待。现新浏览器场景采用既有CI DPR0.5，等待真实薄蜡GPU缓冲已上传后再输入；慢回弹观察器显式要求真实非零首帧深度大于0.0001，其余质感默认仍0.001，捕获／可信按下／真实上传／500ms／碰撞断言均保留。旧托盘方向测试仅在CI将DPR0.25调到0.125，完整网格、碰撞、阴影和时钟不变，不涉及产品显示质量。

SwiftShader、DPR0.5／flight0.125、正常CPU下，短按桌面与触屏两例均实际通过，原始记录 slow-orb-ci-default-software-validation.txt；该组合命令在之后的旧托盘阶段被主动中断，以暂停后台负载，不能称整条命令完成通过。旧托盘方向case单独执行 `node --test --test-name-pattern='rotated real interaction' tests/thin-wax-browser.test.cjs` 完整1/1通过，退出码0，30.58秒，原始 slow-orb-ci-flight-software-final.txt。额外4倍CPU限速压力尝试3例失败记录 slow-orb-ci-raster-validation.txt 保留，不将其混为普通CI或手机通过结果。产品运行包仍为ccb686，须等待新head远端完整检查通过再合并。
