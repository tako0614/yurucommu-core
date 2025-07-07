import { createSignal, Show } from "solid-js";
import SolidCropper from "../Cropper.js/SolidCropper";
import { resizeImage } from "../Cropper.js/CropperDemo";

type CreatePostFormProps = {
  onClose: () => void;
  onSubmit: () => void;
  postText: () => string;
  setPostText: (text: string) => void;
  postImage: () => string | null;
  setPostImage: (image: string | null) => void;
  error: string | null;
};

export default function CreatePostForm(props: CreatePostFormProps) {
  const {
    onClose,
    onSubmit,
    postText,
    setPostText,
    postImage,
    setPostImage,
    error,
  } = props;

  // クロップモードの状態
  const [isCropping, setIsCropping] = createSignal(false);
  // クロップ前の元画像
  const [originalImage, setOriginalImage] = createSignal<string | null>(null);
  // クロッパーのref
  const cropperRef = { handleCrop: () => {} };

  const handleImageUpload = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // 元画像を保存してクロップモードに入る
        setOriginalImage(e.target?.result as string);
        setIsCropping(true);
      };
      reader.readAsDataURL(input.files[0]);
    }
  };

  const handleCropComplete = () => {
    // クロッパーからクロップされた画像を取得
    cropperRef.handleCrop();
    setIsCropping(false);
  };

  const handleCropCancel = () => {
    setOriginalImage(null);
    setIsCropping(false);
  };

  return (
    <div class="absolute inset-0 z-10 flex flex-col overflow-hidden h-screen">
      <div class="flex justify-between items-center border-b border-gray-200 p-4">
        <button onClick={onClose} class="text-gray-500">
          キャンセル
        </button>
        <h2 class="font-bold text-lg">新規投稿</h2>
        <button
          onClick={onSubmit}
          class="bg-blue-500 px-4 py-1 rounded-full text-white disabled:opacity-50"
          disabled={!postText && !postImage}
        >
          投稿
        </button>
      </div>

      <Show when={error}>
        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mx-4 my-2">
          {error}
        </div>
      </Show>

      <Show when={isCropping() && originalImage()}>
        <div class="flex-1 flex flex-col overflow-auto p-4">
          <div class="flex justify-end space-x-3 mt-4">
            <button
              onClick={handleCropCancel}
              class="px-4 py-2 border border-gray-300 rounded-full"
            >
              キャンセル
            </button>
            <button
              onClick={handleCropComplete}
              class="bg-blue-500 px-6 py-2 rounded-full text-white"
            >
              適用
            </button>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <div class="w-full max-w-md overflow-hidden">
              <SolidCropper
                src={originalImage() || ""}
                aspectRatio={1}
                onCropped={async (dataUrl) => {
                  const resizeedImage = await resizeImage(dataUrl, 1024, 1024);
                  setPostImage(resizeedImage);
                }}
                ref={cropperRef}
              />
            </div>
          </div>
        </div>
      </Show>

      <Show when={!isCropping()}>
        <div class="flex-1 overflow-auto p-4">
          <div class="flex items-center mb-2">
            <label class="cursor-pointer flex items-center justify-center w-10 h-10 text-blue-500 mr-2 rounded-full hover:bg-gray-100">
              <input
                type="file"
                accept="image/*"
                class="hidden"
                onChange={handleImageUpload}
              />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </label>
            <span class="text-sm text-gray-500">画像を追加</span>
          </div>

          <textarea
            value={postText()}
            onInput={(e) => setPostText(e.target.value)}
            placeholder="いまどうしてる？"
            class="w-full h-32 p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 bg-black"
          />

          {postImage() && (
            <div class="relative mt-4">
              <img
                src={postImage() || ""}
                alt="アップロード画像"
                class="max-w-full h-auto rounded-lg"
              />
              <button
                onClick={() => setPostImage(null)}
                class="absolute top-2 right-2 bg-gray-800 bg-opacity-70 rounded-full w-8 h-8 flex items-center justify-center text-white"
              >
                ×
              </button>
            </div>
          )}
        </div>

        <div class="border-t border-gray-200 p-4 flex justify-end">
          <button
            onClick={onSubmit}
            class="bg-blue-500 px-6 py-2 rounded-full text-white disabled:opacity-50"
            disabled={!postText() && !postImage()}
          >
            投稿する
          </button>
        </div>
      </Show>
    </div>
  );
}
