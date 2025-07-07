export async function resizeBase64Image(
  base64: string,
  maxSizeKB: number = 256,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img: HTMLImageElement = new Image();
    img.onload = async function () {
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context is not supported"));
        return;
      }

      let width: number = img.width;
      let height: number = img.height;

      // 初期の canvas サイズ設定
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      let quality: number = 0.9; // 初期圧縮率
      let resultBase64: string = canvas.toDataURL("image/jpeg", quality);

      // 256KB 以下になるように調整
      while (getBase64SizeKB(resultBase64) > maxSizeKB && quality > 0.1) {
        quality -= 0.05;
        resultBase64 = canvas.toDataURL("image/jpeg", quality);
      }

      resolve(resultBase64);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = base64;
  });
}

// Base64 のサイズを KB 単位で取得
export function getBase64SizeKB(base64: string): number {
  return Math.round((base64.length * 3) / 4 / 1024);
}
