# 七模型 × 三确认预设：21组合

运行包 SHA256：`1c90a123e4149feed209a3793946479a1ec47c790f65610e401a209c439c3827`。每行均有桌面/原生触屏模拟昼夜4组实际按压、滑动、释放、换色恢复、最终试捏，以及8组旋转光照检查。交互由实际 GPU 位置上传确认，静态截图不充当交互证明。慢回弹自然恢复在换色前等待并检查精确归位。输入取消、离页释放和原球三预设另由自动化回归覆盖。手机范围是模拟器，不是真机性能验收。

| 模型 | 预设 | 交互结果 | 1700ms实际最大压深范围 | 旋转表面亮度P05最低/255 | 操作证据 |
| --- | --- | --- | --- | --- | --- |
| cloud | clay | 通过 | 0.2291–0.2316 | 132.63 | [录屏](clay/cloud-clay-interaction.webm) |
| paw | clay | 通过 | 0.2241–0.2261 | 136.85 | [录屏](clay/paw-clay-interaction.webm) |
| cylinder | clay | 通过 | 0.2476–0.2495 | 122.64 | [录屏](clay/cylinder-clay-interaction.webm) |
| donut | clay | 通过 | 0.1748–0.1781 | 124.92 | [录屏](clay/donut-clay-interaction.webm) |
| pyramid | clay | 通过 | 0.2207–0.2235 | 124.64 | [录屏](clay/pyramid-clay-interaction.webm) |
| flower | clay | 通过 | 0.2194–0.2200 | 131.35 | [录屏](clay/flower-clay-interaction.webm) |
| star | clay | 通过 | 0.2208–0.2223 | 132.35 | [录屏](clay/star-clay-interaction.webm) |
| cloud | marshmallow | 通过 | 0.3027–0.3174 | 155.23 | [录屏](marshmallow/cloud-marshmallow-interaction.webm) |
| paw | marshmallow | 通过 | 0.3031–0.3055 | 159.45 | [录屏](marshmallow/paw-marshmallow-interaction.webm) |
| cylinder | marshmallow | 通过 | 0.3503–0.3517 | 149.32 | [录屏](marshmallow/cylinder-marshmallow-interaction.webm) |
| donut | marshmallow | 通过 | 0.1997–0.2000 | 150.74 | [录屏](marshmallow/donut-marshmallow-interaction.webm) |
| pyramid | marshmallow | 通过 | 0.2935–0.2963 | 149.81 | [录屏](marshmallow/pyramid-marshmallow-interaction.webm) |
| flower | marshmallow | 通过 | 0.2875–0.2911 | 154.24 | [录屏](marshmallow/flower-marshmallow-interaction.webm) |
| star | marshmallow | 通过 | 0.2954–0.2986 | 154.82 | [录屏](marshmallow/star-marshmallow-interaction.webm) |
| cloud | slow-rebound | 通过 | 0.3282–0.3282 | 129.06 | [录屏](slow-rebound/cloud-slow-rebound-interaction.webm) |
| paw | slow-rebound | 通过 | 0.3091–0.3091 | 132.56 | [录屏](slow-rebound/paw-slow-rebound-interaction.webm) |
| cylinder | slow-rebound | 通过 | 0.4562–0.4563 | 118.43 | [录屏](slow-rebound/cylinder-slow-rebound-interaction.webm) |
| donut | slow-rebound | 通过 | 0.1464–0.1464 | 121.35 | [录屏](slow-rebound/donut-slow-rebound-interaction.webm) |
| pyramid | slow-rebound | 通过 | 0.2316–0.2316 | 120.43 | [录屏](slow-rebound/pyramid-slow-rebound-interaction.webm) |
| flower | slow-rebound | 通过 | 0.2298–0.2298 | 126.85 | [录屏](slow-rebound/flower-slow-rebound-interaction.webm) |
| star | slow-rebound | 通过 | 0.2692–0.2692 | 127.92 | [录屏](slow-rebound/star-slow-rebound-interaction.webm) |

七款 GLB 合计 1,948,420 B。逐视角数据及资产 SHA 位于各预设目录的 validation.json。
