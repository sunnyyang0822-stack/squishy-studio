# 甜甜圈：Issue #30 可编辑初稿

仅复用 `clay`。源几何是单一闭合连续表面，无相交内部壳，无贴图。材质为可替换 PBR 占位；浏览器使用已有色卡与独立光学预设。

坐标：米制、Blender Z-up，导出 glTF Y-up；正面为 glTF +Z。原点为包围盒中心，所有对象变换已应用。浏览器落地与相机按包围盒适配。

复现：在仓库根目录运行 `blender --background --python scripts/build-styles.py -- donut`。此脚本只用于独立后台进程，会清空当前场景；不要在未保存的交互场景中执行。导出仅选择表面，不含相机或灯光。`.blend` 保留可编辑表面与独立审阅灯光。

几何统计和包围盒见 `artifacts/issue-30/models/donut.json`；正、侧、背、底图在同目录。浏览器验证另由运行时测试记录，Blender 图不能代替可玩验收。


网格、法线与封闭性由生成脚本断言；GLB 无外部依赖，单 mesh / primitive / material。回滚时成对恢复源 `.blend` 与运行时 `.glb`，然后重新运行资产测试。
