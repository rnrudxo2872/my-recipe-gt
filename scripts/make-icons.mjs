// icon.png(원본)에서 앱 아이콘, 파비콘을 만든다.  실행: npm run icons
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const SRC = "icon.png";
const OUT = "public";
const BRAND = { r: 253, g: 191, b: 70, alpha: 1 }; // 아이콘 바탕 노랑

mkdirSync(`${OUT}/icons`, { recursive: true });

// 원본 둘레의 투명 여백을 잘라 둥근 사각형만 남긴다.
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 200) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const side = Math.max(maxX - minX, maxY - minY) + 1;
const tile = await sharp(SRC)
  .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
  .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

async function plain(size, file) {
  await sharp(tile).resize(size, size).png({ compressionLevel: 9, palette: size >= 96, quality: 92 }).toFile(`${OUT}/${file}`);
}

// 노란 바탕을 꽉 채운 버전. 안드로이드 마스커블 아이콘과 iOS 홈 화면 아이콘용
async function filled(size, scale, file) {
  const inner = Math.round(size * scale);
  const resized = await sharp(tile).resize(inner, inner).png().toBuffer();
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
