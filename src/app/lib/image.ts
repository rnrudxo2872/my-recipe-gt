// 사진을 폰에서 줄여서 올린다. 무료 서버는 사진을 줄일 CPU 여유가 없어서 브라우저가 한다.

const MAX_SIDE = 1280;

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  let width: number;
  let height: number;
  let source: CanvasImageSource;
  if (bitmap) {
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } else {
    const img = await loadImage(file);
    width = img.naturalWidth;
    height = img.naturalHeight;
    source = img;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("사진을 처리할 수 없어요.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close();
  for (const [type, quality] of [
    ["image/webp", 0.8],
    ["image/jpeg", 0.82],
    ["image/jpeg", 0.65],
  ] as const) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
    // 일부 브라우저는 webp를 못 만들고 png를 돌려준다.
    if (blob && blob.type === type && blob.size < 1_000_000) return blob;
  }
  throw new Error("사진이 너무 커요. 다른 사진을 골라 주세요.");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 열 수 없어요."));
    };
    img.src = url;
  });
}
