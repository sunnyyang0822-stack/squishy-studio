const { inflateSync } = require('node:zlib');

// Decode browser screenshots for pixel comparison, independent of PNG compression.
function pixels(buffer) {
  let width, height, channels;
  const data = [];
  for (let offset = 8; offset < buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const part = buffer.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = part.readUInt32BE(0); height = part.readUInt32BE(4);
      if (part[8] !== 8 || ![2, 6].includes(part[9]) || part[12] !== 0) throw new Error('不支持的 PNG 格式');
      channels = part[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') data.push(part);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const decoded = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? decoded[at - channels] : 0;
      const up = y ? decoded[at - stride] : 0;
      const corner = y && x >= channels ? decoded[at - stride - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      if (predictor === undefined) throw new Error('PNG 滤镜错误');
      decoded[at] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, channels, decoded };
}

exports.comparePng = (before, after) => {
  const a = pixels(before), b = pixels(after);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) throw new Error('截图尺寸或通道不一致');
  let changed = 0, significant = 0, maximum = 0;
  const bounds = { left: a.width, top: a.height, right: -1, bottom: -1 };
  for (let i = 0; i < a.decoded.length; i += a.channels) {
    let delta = 0;
    for (let channel = 0; channel < a.channels; channel++) delta = Math.max(delta, Math.abs(a.decoded[i + channel] - b.decoded[i + channel]));
    if (delta) {
      changed++;
      const at = i / a.channels;
      bounds.left = Math.min(bounds.left, at % a.width); bounds.right = Math.max(bounds.right, at % a.width);
      bounds.top = Math.min(bounds.top, Math.floor(at / a.width)); bounds.bottom = Math.max(bounds.bottom, Math.floor(at / a.width));
    }
    if (delta > 1) significant++;
    maximum = Math.max(maximum, delta);
  }
  return { changedPixels: changed, significantPixels: significant, maximumChannelDelta: maximum, bounds: changed ? bounds : null, totalPixels: a.width * a.height, ratio: changed / (a.width * a.height) };
};
