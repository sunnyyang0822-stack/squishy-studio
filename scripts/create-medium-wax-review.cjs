// Local review artifact only; it is never part of the product page or bundle.
const fs = require('node:fs');
const path = require('node:path');
const folder = path.resolve('.tmp/issue-41');
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'review.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>圆球黏土 · 薄蜡 / 中蜡走查</title>
<style>
body{font:16px/1.6 system-ui,sans-serif;margin:24px;background:#faf7f8;color:#382b36}h1{font-size:24px}a{color:#943d70}nav,fieldset{margin:16px 0}label{margin-right:18px}button,select{font:inherit;padding:6px 12px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}img,video{display:block;width:100%;background:#eee;border-radius:8px}figcaption{font-weight:600;margin:8px 0}.notes{color:#675963} @media(max-width:650px){body{margin:12px}main{grid-template-columns:1fr}}
</style>
<h1>圆球黏土：薄蜡 / 中蜡</h1>
<nav><a href="/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=medium&step=shell" target="_blank">打开中蜡交互</a> · <a href="/squishy/cloud/?style=orb&coreMaterial=clay&coreColor=mint&shellColor=rose&waxThickness=thin&step=shell" target="_blank">打开薄蜡交互</a></nav>
<p>同一个圆球、黏土内芯、薄荷绿内芯色、玫瑰粉壳色和操作顺序。中蜡真实厚度 0.028（薄蜡 0.014），96 块分区（薄蜡 180）；平均碎块面积 1.875 倍，中位面积约 1.98 倍。</p>
<fieldset><legend>对照环境</legend><label>设备 <select id="device"><option value="desktop">桌面</option><option value="mobile">模拟手机 390 × 844</option></select></label><label>光照 <select id="theme"><option value="day">白天</option><option value="night">夜晚</option></select></label><label>画面 <select id="stage"><option value="side">旋转后断口</option><option value="falling">碎裂与掉落</option><option value="deep">深压破口</option><option value="crack">点击裂纹</option><option value="intact">完整外观</option></select></label></fieldset>
<main><figure><figcaption>薄蜡 · 0.014 · 180 块</figcaption><img id="thinImage" alt="薄蜡实际截图"><video id="thinVideo" controls muted playsinline preload="metadata"></video></figure><figure><figcaption>中蜡 · 0.028 · 96 块</figcaption><img id="mediumImage" alt="中蜡实际截图"><video id="mediumVideo" controls muted playsinline preload="metadata"></video></figure></main>
<p><button id="replay">同时重播两段录屏</button></p><p class="notes">录屏保持正常速度，未放大碎片或断面。手机为 Edge / Chromium 触摸模拟，旋转使用产品现有的鼠标操作；未作手机真机验收。完整外观应接近，重点查看裂纹之间的跨度、脱落块和断口边缘。若差异仍不够清楚，请继续反馈。</p>
<script>
const device=document.querySelector('#device'),theme=document.querySelector('#theme'),stage=document.querySelector('#stage');
function update(videos=true){for(const id of ['thin','medium']){const stem=device.value+'-'+theme.value+'-'+id;document.querySelector('#'+id+'Image').src=stem+'-'+stage.value+'.png';if(videos)document.querySelector('#'+id+'Video').src=stem+'.webm';}}
device.onchange=theme.onchange=()=>update();stage.onchange=()=>update(false);document.querySelector('#replay').onclick=()=>{for(const id of ['thin','medium']){const video=document.querySelector('#'+id+'Video');video.currentTime=0;video.play();}};update();
</script></html>`);
console.log('Local review page: /.tmp/issue-41/review.html');
