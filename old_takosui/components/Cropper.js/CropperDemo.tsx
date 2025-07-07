import { createSignal, JSX, onCleanup, onMount } from "solid-js";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import SolidCropper from "./SolidCropper";
import image from "./Image";

const CropperDemo = () => {
  const [priviewImage, setPreviewImage] = createSignal<string | null>(null);
  const cropperRef = {} as { handleCrop: () => void };

  const handleCropped = async (dataUrl: string) => {
    const image = dataUrl;
    const resizedImage = await resizeImage(image, 256, 256);
    console.log(await checkImage(resizedImage, 256, 256));
    setPreviewImage(resizedImage);
  };

  // 外部から直接トリミングを実行するための関数
  const triggerCrop = () => {
    cropperRef.handleCrop();
  };
  return (
    <div class="min-h-screen bg-gradient-to-br from-gray-50 to-blue-100 p-4 sm:p-8">
      <div class="max-w-6xl mx-auto bg-white rounded-xl shadow-xl overflow-hidden">
        <h1 class="text-2xl md:text-3xl font-bold text-center p-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          画像トリミングツール
        </h1>

        <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 元画像エリア */}
          <div class="flex flex-col">
            <h2 class="text-lg font-semibold mb-3 text-gray-700 border-l-4 border-blue-500 pl-3">
              編集エリア
            </h2>
            <div class="border-2 border-blue-200 rounded-lg overflow-hidden h-80 bg-gray-50">
              <SolidCropper
                src={image}
                onCropped={handleCropped}
                aspectRatio={1}
                ref={cropperRef}
              />
            </div>
          </div>

          {/* プレビューエリア */}
          <div class="flex flex-col">
            <h2 class="text-lg font-semibold mb-3 text-gray-700 border-l-4 border-green-500 pl-3">
              プレビュー
            </h2>
            <div class="border-2 border-green-200 rounded-lg overflow-hidden h-80 flex items-center justify-center bg-gray-50">
              <img
                src={priviewImage() ?? ""}
                class="max-h-full max-w-full object-contain"
                alt="トリミングされた画像"
              />
            </div>
            <p class="text-sm text-gray-500 mt-2 text-center italic">
              ※トリミングした画像がここに表示されます
            </p>
          </div>
        </div>

        <div class="flex justify-center pb-8">
          <button
            onClick={triggerCrop}
            class="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-3 px-8 rounded-full transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 shadow-lg"
          >
            トリミングを実行
          </button>
        </div>
      </div>
    </div>
  );
};

export default CropperDemo;

export const checkImage = async (
  imageBase64: string,
  height: number,
  width: number,
) => {
  return new Promise<{ isValid: boolean; message: string }>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const imgWidth = img.width;
      const imgHeight = img.height;
      const tolerance = 0.01;
      if (imgHeight < height - tolerance || imgHeight > height + tolerance) {
        console.log(imgHeight, height);
        resolve({ isValid: false, message: `高さが${height}pxではありません` });
        return;
      }
      if (imgWidth < width - tolerance || imgWidth > width + tolerance) {
        resolve({ isValid: false, message: `幅が${width}pxではありません` });
        return;
      }
      resolve({ isValid: true, message: "" });
    };

    img.onerror = () => {
      resolve({ isValid: false, message: "画像の読み込みに失敗しました" });
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
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
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
      resolve(canvas.toDataURL());
    };

    img.onerror = () => {
      resolve("");
    };

    img.src = imageBase64;
  });
};
