// icon.png(원본)에서 앱 아이콘, 파비콘을 만든다.  실행: npm run icons
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const SRC = "icon.png";
const OUT = "public";
const BRAND = { r: 252, g: 241, b: 234, alpha: 1 }; // 아이콘 타일 바탕 크림색
const RADIUS = 0.267; // 타일 모서리 반지름(한 변 대비)
const INSET = 0.01; // 타일 둘레 여백(한 변 대비)

mkdirSync(`${OUT}/icons`, { recursive: true });

// 원본 둘레에는 흩어진 반투명 얼룩이 있다. 픽셀 하나가 아니라
// 불투명한 픽셀이 5% 넘게 들어찬 행·열만 타일로 본다.
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const opaque = (x, y) => data[(y * W + x) * 4 + 3] > 200;
const rows = [], cols = [];
for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (opaque(x, y)) n++; rows.push(n / W > 0.05); }
for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (opaque(x, y)) n++; cols.push(n / H > 0.05); }
const minY = rows.indexOf(true), maxY = rows.lastIndexOf(true);
const minX = cols.indexOf(true), maxX = cols.lastIndexOf(true);
// 정사각형으로 맞춘다(긴 쪽을 가운데 기준으로 조금 잘라 낸다).
const side = Math.min(maxX - minX, maxY - minY) + 1;
const left = minX + Math.floor((maxX - minX + 1 - side) / 2);
const top = minY + Math.floor((maxY - minY + 1 - side) / 2);
const crop = await sharp(SRC).extract({ left, top, width: side, height: side }).ensureAlpha().raw().toBuffer();

// 원본 타일 바탕은 테두리가 거칠고 안쪽에 밝은 테가 있다. 그림(냄비·김)만 떼어 내
// 직접 그린 매끈한 크림색 둥근 사각형 위에 얹는다. 바탕색과 많이 다른 픽셀만 그림으로 본다.
const art = Buffer.alloc(crop.length);
const margin = side * 0.08; // 그림은 타일 안쪽에만 있다. 가장자리 얼룩은 버린다.
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const i = (y * side + x) * 4;
    if (x < margin || y < margin || x >= side - margin || y >= side - margin) continue;
    const d = Math.max(Math.abs(crop[i] - BRAND.r), Math.abs(crop[i + 1] - BRAND.g), Math.abs(crop[i + 2] - BRAND.b));
    const a = Math.min(1, Math.max(0, (d - 10) / 30));
    art[i] = crop[i];
    art[i + 1] = crop[i + 1];
    art[i + 2] = crop[i + 2];
    art[i + 3] = Math.round(a * crop[i + 3]);
  }
}
const roundRect = (fill) => {
  const pad = side * INSET;
  const r = (side - pad * 2) * RADIUS;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect x="${pad}" y="${pad}" width="${side - pad * 2}" height="${side - pad * 2}" rx="${r}" ry="${r}" fill="${fill}"/></svg>`,
  );
};
const artwork = await sharp(art, { raw: { width: side, height: side, channels: 4 } }).png().toBuffer();
const tile = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: roundRect(`rgb(${BRAND.r},${BRAND.g},${BRAND.b})`) }, { input: artwork }])
  .png()
  .toBuffer();

async function plain(size, file) {
  await sharp(tile).resize(size, size).png({ compressionLevel: 9, palette: size >= 96, quality: 92 }).toFile(`${OUT}/${file}`);
}

// 크림색 바탕을 꽉 채운 버전. 안드로이드 마스커블 아이콘과 iOS 홈 화면 아이콘용.
// 테두리 없이 그림만 얹어야 바탕과 타일 경계가 보이지 않는다.
async function filled(size, scale, file) {
  const inner = Math.round(size * scale);
  const resized = await sharp(artwork).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: resized, gravity: "center" }])
    .png({ compressionLevel: 9, palette: size >= 96, quality: 92 })
    .toFile(`${OUT}/${file}`);
}

await plain(192, "icons/icon-192.png");
await plain(512, "icons/icon-512.png");
await plain(96, "icons/logo-96.png");
await filled(192, 0.92, "icons/maskable-192.png");
await filled(512, 0.92, "icons/maskable-512.png");
await filled(180, 1, "apple-touch-icon.png");
await plain(32, "favicon-32.png");
await plain(16, "favicon-16.png");

// favicon.ico: PNG를 그대로 담는 ICO(16, 32, 48)
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(tile).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const o = i * 16;
  dir.writeUInt8(s, o);
  dir.writeUInt8(s, o + 1);
  dir.writeUInt8(0, o + 2);
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(pngs[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([header, dir, ...pngs]));

console.log("아이콘 생성 완료");
