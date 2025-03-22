// クライアントサイド（ブラウザ）で実行されているかをチェック
const isBrowser = typeof window !== "undefined" &&
    typeof window.document !== "undefined";
import canvas from "canvas";

// 環境に応じたImageの取得
const getImageImplementation = () => {
    if (isBrowser) {
        return window.Image;
    } else {
        // Node.js環境の場合は、canvas パッケージを使用する
        // 注: このためには `npm install canvas` が必要
        try {
            // 動的インポートでエラーを避ける
            return canvas.Image;
        } catch (error) {
            console.error(
                "canvas package is not installed. Please run: npm install canvas",
            );
            // フォールバックとしてダミーのImage実装を返す
            return class DummyImage {
                width = 0;
                height = 0;
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                set src(_: string) {
                    if (this.onerror) this.onerror();
                }
            };
        }
    }
};

export const checkImage = async (
    imageBase64: string,
    height: number,
    width: number,
) => {
    return new Promise<{ isValid: boolean; message: string }>((resolve) => {
        const ImageImpl = getImageImplementation();
        const img = new ImageImpl();
        img.onload = () => {
            const imgWidth = img.width;
            const imgHeight = img.height;
            const tolerance = 0.01;
            if (
                imgHeight < height - tolerance || imgHeight > height + tolerance
            ) {
                resolve({
                    isValid: false,
                    message: `高さが${height}pxではありません`,
                });
                return;
            }
            if (imgWidth < width - tolerance || imgWidth > width + tolerance) {
                resolve({
                    isValid: false,
                    message: `幅が${width}pxではありません`,
                });
                return;
            }
            resolve({ isValid: true, message: "" });
        };

        img.onerror = () => {
            resolve({
                isValid: false,
                message: "画像の読み込みに失敗しました",
            });
        };

        img.src = imageBase64;
    });
};

export const resizeImage = async (
    imageBase64: string,
    width: number,
    height: number,
) => {
    return new Promise<string>((resolve) => {
        const ImageImpl = getImageImplementation();
        const img = new ImageImpl();
        img.onload = () => {
            // Node.js環境とブラウザ環境でcanvas作成を分ける
            let canvas, ctx;
            if (isBrowser) {
                canvas = document.createElement("canvas");
                ctx = canvas.getContext("2d");
            } else {
                try {
                    const nodeCanvas = require("canvas");
                    canvas = nodeCanvas.createCanvas(width, height);
                    ctx = canvas.getContext("2d");
                } catch (error) {
                    resolve("");
                    return;
                }
            }

            if (!ctx) {
                resolve("");
                return;
            }

            // アスペクト比を維持したままリサイズ
            const aspectRatio = img.width / img.height;
            if (aspectRatio > width / height) {
                canvas.width = width;
                canvas.height = width / aspectRatio;
            } else {
                canvas.width = height * aspectRatio;
                canvas.height = height;
            }

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // ブラウザとNode.js環境で結果の取得方法を分ける
            if (isBrowser) {
                resolve(canvas.toDataURL());
            } else {
                try {
                    resolve(canvas.toDataURL());
                } catch (error) {
                    resolve("");
                }
            }
        };

        img.onerror = () => {
            resolve("");
        };

        img.src = imageBase64;
    });
};
