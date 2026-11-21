# 首版制作流程：接口与文件边界

任务来源：Issue #3 全文及 2026-11-21「首版流程收敛与绘画移至第二版」决策。基线为 origin/main `c140b5cd1d8aaacd3c9c7f5558911927b4f48974`。PR #61 在开始时仍为 OPEN，head `d0d5e2a`；本任务不改动、合并或关闭它，不复制其恢复协调实现。

## 需要产品负责人转交的接口提案

这是 A 的可执行页面合同。B 已在 PR #62 确认并实现同一生命周期接口（下述交接记录）；C、D 尚未确认。请各负责人回传模块路径、导出名、支持矩阵和发布提交。未发布／未对齐能力列为阻塞，不能把裸芯或预览冒充完整成品。

### 配方（版本 1）

```js
{
  styleId: 'orb',          // orb/cloud/cylinder/donut/pyramid/flower/star；不启用 paw
  coreMaterial: 'clay',    // clay/marshmallow/butter；butter 沿用 slow-rebound + full-matte
  coreColor: 'rose',       // detail/orb-colors.mjs 的稳定 ID
  shellMaterial: 'wax',    // wax/polish
  shellColor: 'rose',      // 当前选中壳片的颜色
  waxThickness: 'medium',  // thin/medium/thick；非蜡有效配方为 null
}
```

编辑偏好另外记录 `shellColors: { wax: 'rose', polish: 'cream' }`，以及蜡厚度；默认两种壳均为 rose，不将它们混入实际 feelId。最终／保存只传上述有效配方，涂鸦、填充物、糖壳、账号、支付、签到不属于首版。

### B：成品场景

建议 B 独占 `src/finished-scene.js` 及其成品测试。页面接入点为 A 的 `make/providers.js`；B 不改页面和状态文件。

```js
createFinishedScene(mount, { onUnavailable, onEvent }) => ({
  supports(recipe): boolean,
  initialize(recipe, { signal }): Promise<void>,
  update(recipe, { signal }): Promise<void>,
  restore(): void | Promise<void>,
  stopInput(): void,
  dispose(): void,
})
```

initialize/update 必须遵循当前 prepare/commit/dispose 与 AbortSignal，最新请求生效，失败保留可恢复状态；同配方 restore 恢复当前完整壳、芯和姿态，不改配方，不新增一套手感。换造型／内芯工厂可重建实例，换颜色／外壳配置复用宿主。同步返回 unsupported 或抛出可读错误，不静默裸芯降级。stopInput、失焦、后台、离页取消完整收尾。音频事件由 B 与 C 对齐，A 不虚构裂声事件。

当前主线合同仅确认：蜡最终试捏为 orb×clay×thin/medium/thick；其他蜡组合只是制作预览。A 暂以此矩阵为基线适配，其他蜡组合阻止合成。指甲油七种非猫爪造型×三种内芯沿用已确认预设。B 确认扩展成品接口后才能解除蜡组合阻塞，A 不擅自扩大。

2026-11-21 交接记录：B 的 PR #62（开始审阅时 head `3f3f0bf`）明确实现本提案，原生浏览器入口 `/src/finished-scene.js`，另提供 `onState` 和 `onEvent`。其合同要求先顺序集成共享 `src/orb-preview.js` 后，A 再在 `make/providers.js` 导入；B PR 当前 Draft，仍有真实性能／完整矩阵和真机验收阻塞。该 `supports` 仅表示实现能力，不表示所有组合发布通过。A 不合并或拷贝该 PR，不在其阻塞解除前通过隐藏预览启用全部蜡皮。

### C：音频

C 独占音频模块及音色资源；建议 `src/product-audio.js`。接口为 `createProductAudio({ muted: true })`，返回 `unlock()/setMuted(boolean)/handleEvent(event)/stop()/dispose()`。解锁须来自真实用户手势。事件字段及映射由 B、C 确认；A 只负责交互入口与生命周期，不写假音源。目前未交接，不展示无效声音按钮。

### D：本机作品

D 独占 `works/` 与存储模块；建议 `src/local-works.mjs`。接口 `save({ recipeVersion: 1, recipe })`、`get(id)`、`list()`、`remove(id)`。只保存最终配方，不存运行时网格、损伤、草稿或第二版笔迹。页面通过确认后的 get/save 适配器打开／保存；未交接时不展示假保存或“我的作品”入口。不声明永久、跨设备保存。错误、清理数据与版本兼容交由 D 定义。

## A 文件归属

- `make/`：首版状态、有效配方、URL 与浏览器历史、页面、控制、合成过场、提供者适配。
- `src/shell-samples.js`：只渲染独立弧面壳片选配；不含成品碎裂，不改内芯工厂。
- `assets/shell-samples.js` 与对应构建脚本：现有 esbuild/Three.js，不升级依赖。
- `collections/`：首版主入口与猫爪暂停状态，保留首页 Hero。
- 本任务 `tests/v1-*.test.cjs`、`artifacts/v1-making/`。
- `detail/`、`squishy/cloud/`、现有形变／蜡皮／指甲油内核与 PR #61 保持不动。

## 页面与恢复规则

五段为：合集选造型 → core 内芯试捏 → shell 独立壳片 → making 合成 → play 成品。核心页面不出现绘画、填充物、糖壳等入口。旧详情链接继续使用旧详情页面，不作为首版新入口。

返回修改保留内芯、两类壳颜色和蜡厚度；修改后重新合成使用新配方，成品手动“恢复成品”保留当前有效配方。URL 只保存枚举配置和合法步骤，同页历史保留偏好；刷新按合法参数恢复，making/play 在能力不支持时回 shell。未保存作品不宣称已保存。

壳片两种样本是选配模型，与成品实例隔离；切到壳片时停止并销毁内芯宿主（旧旋转绑定在 document 上，不能保留隐藏监听）；回内芯使用原工厂重建，不保留试捏损伤，但完整保留选项。合成只用真实选配样本的短汇聚过渡表达连接，没有假百分比；准备完成后进入真实成品，失败可返回／重试，无自动跳过错误。

## 尚未完成的集成门槛

1. B PR #62 的完整矩阵、性能与发布验收通过，共享宿主顺序进入 main 后再替换 A 的基线适配；当前接口已对齐，发布仍阻塞。
2. C 音频模块及真实事件合同、真机视听验收。
3. D 本机配方存储与“我的作品”完整闭环。
4. 实体 iPhone/Android 验证；仿真不能代替真机。

以上未对齐前 PR 作为集成阶段交付，不能宣称首版全部完成或自行合并 B/C/D 的 PR。
