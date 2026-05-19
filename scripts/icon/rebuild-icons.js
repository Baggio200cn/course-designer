/**
 * rebuild-icons.js — v4.3.3 · 把 jimeng 原图处理成 Electron 多尺寸 icon
 *
 * 输入：桌面 jimeng-2026-05-20-... 驭_字 logo PNG
 * 输出：
 *   resources/icons/icon.png   1024×1024（窗口/任务栏用）
 *   resources/icons/icon.ico   多尺寸 ICO（16/24/32/48/64/128/256，安装器/exe 用）
 *   resources/icons/icon-256.png / icon-128.png / icon-64.png / icon-32.png / icon-16.png（备用）
 *
 * 不引入新依赖（H8）：ICO 用手写 ICONDIR + ICONDIRENTRY 包装 PNG blob。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = process.argv[2]
  || 'C:/Users/Zhaol/Desktop/jimeng-2026-05-20-1821-极致简约的中文汉字_驭_字 logo 设计，奔马的身体造型本身就构成_驭_字左半....png';
const OUT_DIR = path.resolve(__dirname, '../../resources/icons');
const SIZES = [16, 24, 32, 48, 64, 128, 256];   // ICO 内含的尺寸
const MAIN_SIZES = [256, 512, 1024];             // 额外大尺寸 PNG

function buildIco(pngBuffers) {
  // ICO 格式：
  //   ICONDIR (6 bytes)：reserved=0 / type=1 / count=N
  //   ICONDIRENTRY * N (16 bytes each)
  //   followed by N PNG blobs
  const N = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(N, 4);

  const entries = Buffer.alloc(16 * N);
  let dataOffset = 6 + 16 * N;
  const blobs = [];

  pngBuffers.forEach((info, i) => {
    const { size, buf } = info;
    const w = size === 256 ? 0 : size;  // ICO 中 256 用 0 表示
    const h = size === 256 ? 0 : size;
    entries.writeUInt8(w, i * 16 + 0);
    entries.writeUInt8(h, i * 16 + 1);
    entries.writeUInt8(0, i * 16 + 2);  // 调色板
    entries.writeUInt8(0, i * 16 + 3);  // reserved
    entries.writeUInt16LE(1, i * 16 + 4);    // color planes
    entries.writeUInt16LE(32, i * 16 + 6);   // bits per pixel
    entries.writeUInt32LE(buf.length, i * 16 + 8);   // 数据字节数
    entries.writeUInt32LE(dataOffset, i * 16 + 12);  // 数据偏移
    dataOffset += buf.length;
    blobs.push(buf);
  });

  return Buffer.concat([header, entries, ...blobs]);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('源 icon 不存在:', SRC);
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('源:', SRC);
  const srcMeta = await sharp(SRC).metadata();
  console.log(`源尺寸: ${srcMeta.width}×${srcMeta.height} (${srcMeta.format})`);

  // 中心 crop 到正方形（取较短边）
  const side = Math.min(srcMeta.width, srcMeta.height);
  const left = Math.floor((srcMeta.width - side) / 2);
  const top = Math.floor((srcMeta.height - side) / 2);

  // 主 icon.png（1024）
  const mainBuf = await sharp(SRC)
    .extract({ left, top, width: side, height: side })
    .resize(1024, 1024, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), mainBuf);
  console.log(`✓ icon.png (1024×1024, ${(mainBuf.length / 1024).toFixed(1)} KB)`);

  // 备用尺寸（256/512/1024 + ICO 用尺寸）
  for (const s of MAIN_SIZES) {
    if (s === 1024) continue;
    const buf = await sharp(mainBuf).resize(s, s).png({ compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(path.join(OUT_DIR, `icon-${s}.png`), buf);
  }

  // 多尺寸 PNG → ICO
  const pngs = [];
  for (const s of SIZES) {
    const buf = await sharp(mainBuf).resize(s, s, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    pngs.push({ size: s, buf });
    fs.writeFileSync(path.join(OUT_DIR, `icon-${s}.png`), buf);
  }
  const ico = buildIco(pngs);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
  console.log(`✓ icon.ico (含 ${SIZES.join('/')} 尺寸 · ${(ico.length / 1024).toFixed(1)} KB)`);

  console.log('全部完成 →', OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(2); });
