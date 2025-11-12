import { createResource, createSignal, For, Show } from "solid-js";
import Avatar from "./Avatar";
import { api, uploadMedia, useMe } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export default function PostComposer(props: Props) {
  const [selectedCommunity, setSelectedCommunity] = createSignal<string>("");
  const [audience, setAudience] = createSignal<"community" | "all">("all");
  const [text, setText] = createSignal("");
  const [selectedImages, setSelectedImages] = createSignal<File[]>([]);
  const [imagePreviews, setImagePreviews] = createSignal<string[]>([]);
  const [posting, setPosting] = createSignal(false);
  const [communities] = createResource(async () =>
    api("/me/communities").catch(() => [])
  );
  const me = useMe();

  const maxLength = 280;
  const remainingChars = () => maxLength - text().length;
  const isOverLimit = () => remainingChars() < 0;
  const isNearLimit = () => remainingChars() >= 0 && remainingChars() < 20;
  const isDisabled = () =>
    (!text().trim() && selectedImages().length === 0) ||
    isOverLimit() ||
    posting();
  const charCountClass = () =>
    isOverLimit()
      ? "text-red-500"
      : isNearLimit()
      ? "text-amber-500"
      : "text-gray-500 dark:text-gray-400";

  const user = () => me() as any;

  const handleImageSelect = (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files) return;

    const newFiles = Array.from(files);
    const newPreviews: string[] = [];

    newFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            newPreviews.push(e.target.result as string);
            if (newPreviews.length === newFiles.length) {
              setImagePreviews([...imagePreviews(), ...newPreviews]);
            }
          }
        };
        reader.readAsDataURL(file);
      }
    });

    setSelectedImages([...selectedImages(), ...newFiles]);
  };

  const removeImage = (index: number) => {
    const newImages = selectedImages().filter((_, i) => i !== index);
    const newPreviews = imagePreviews().filter((_, i) => i !== index);
    setSelectedImages(newImages);
    setImagePreviews(newPreviews);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const t = text().trim();
    if (!t && selectedImages().length === 0) return;

    setPosting(true);
    try {
      // 画像アチE�Eロード�E琁E��簡易版�E�E
      const mediaUrls: string[] = [];
      for (const file of selectedImages()) {
        // 実際のアチE�Eロード�E琁E�Eここに実裁E
        // 今回はプレビューURLを使用
        mediaUrls.push(await uploadMedia(file));
      }

      const cid = selectedCommunity();
      const postData = {
        text: t,
        type: selectedImages().length > 0 ? "image" : "text",
        media_urls: mediaUrls,
        audience: cid ? audience() : "all",
      };

      if (cid) {
        await api(`/communities/${cid}/posts`, {
          method: "POST",
          body: JSON.stringify(postData),
        });
      } else {
        await api(`/posts`, {
          method: "POST",
          body: JSON.stringify(postData),
        });
      }

      // リセチE��
      setText("");
      setSelectedImages([]);
      setImagePreviews([]);
      setSelectedCommunity("");
      setAudience("all");
      props.onCreated?.();
      props.onClose();
    } finally {
      setPosting(false);
    }
  };

  // form ref for programmatic submit from header on mobile
  let formRef: HTMLFormElement | undefined;

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center sm:items-start sm:pt-12 px-0 sm:px-4"
        onClick={props.onClose}
      >
        <div
          class="bg-white dark:bg-[#111] w-screen h-screen sm:w-full sm:max-w-2xl rounded-none sm:rounded-[20px] shadow-xl border border-gray-200/80 dark:border-white/10 overflow-hidden sm:h-auto sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200/80 dark:border-white/10">
            <button
              type="button"
              aria-label="閉じる"
              class="w-10 h-10 flex items-center justify-center rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-black/15 dark:hover:bg-white/20"
              onClick={props.onClose}
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div class="text-sm font-semibold text-gray-900 dark:text-white">投稿を作成</div>
            <div>
              <button
                type="button"
                class="sm:hidden px-3 py-1.5 rounded-full text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  "background-color": "var(--text)",
                  color: "var(--bg)",
                }}
                onClick={() => formRef?.requestSubmit?.() || formRef?.submit?.()}
                disabled={isDisabled()}
              >
                {posting() ? "投稿中…" : "投稿"}
              </button>
            </div>
          </div>

          <form
            ref={(el) => (formRef = el as HTMLFormElement)}
            class="px-4 sm:px-6 py-4 sm:py-6 overflow-auto flex-1"
            onSubmit={submit}
          >
            <div class="flex flex-col gap-5">
              <Show
                when={user()}
                fallback={(
                  <div class="flex items-start gap-3">
                    <div class="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" />
                    <div class="flex-1 h-12 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />
                  </div>
                )}
              >
                {(currentUser) => (
                  <div class="flex items-start gap-3">
                    <Avatar
                      src={currentUser().avatar_url ?? undefined}
                      alt="ユーザーアイコン"
                      class="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                    />
                    <div class="flex-1">
                      <div class="text-sm font-semibold text-gray-900 dark:text-white">
                        {currentUser().display_name ?? currentUser().handle ?? ""}
                      </div>
                      <div class="text-xs text-muted mt-1">コミュニティを選択してください</div>
                    </div>
                  </div>
                )}
              </Show>

              <textarea
                class="w-full min-h-[140px] resize-none border-none outline-none bg-transparent text-[18px] leading-6 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                placeholder="何を投稿しますか？"
                value={text()}
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
                maxlength={maxLength}
              />

              <Show when={imagePreviews().length > 0}>
                <div class="grid gap-3 grid-cols-2">
                  <For each={imagePreviews()}>
                    {(preview, index) => (
                      <div class="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        <img src={preview} alt={`プレビュー${index() + 1}`} class="w-full h-32 object-cover" />
                        <button
                          type="button"
                          class="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/70"
                          onClick={() => removeImage(index())}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2 sm:gap-3">
                  <label class="w-10 h-10 rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white flex items-center justify-center cursor-pointer transition-colors hover:bg-black/15 dark:hover:bg-white/20">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <input type="file" multiple accept="image/*" class="hidden" onChange={handleImageSelect} />
                  </label>

                  <div class="relative">
                    <select
                      class="appearance-none pl-4 pr-10 py-2 text-sm font-semibold rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                      value={selectedCommunity()}
                      onChange={(e) => setSelectedCommunity((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">コミュニティを選択</option>
                      <For each={(communities() as any[]) || []}>
                        {(c: any) => <option value={c.id}>{c.name}</option>}
                      </For>
                    </select>
                    <svg class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 9-7 7-7-7" />
                    </svg>
                  </div>

                  <div class="flex items-center rounded-full border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                    <button
                      type="button"
                      class={`px-3 py-2 font-medium transition-colors ${audience() === "all"
                        ? "bg-gray-900 text-white dark:bg-white dark:text-black"
                        : "bg-transparent text-gray-600 dark:text-gray-300"}`}
                      onClick={() => setAudience("all")}
                    >
                      公開
                    </button>
                    <button
                      type="button"
                      class={`px-3 py-2 font-medium transition-colors ${audience() === "community"
                        ? "bg-gray-900 text-white dark:bg-white dark:text-black"
                        : "bg-transparent text-gray-600 dark:text-gray-300"}`}
                      onClick={() => setAudience("community")}
                    >
                      非公開
                    </button>
                  </div>
                </div>

                <span class={`text-sm ${charCountClass()}`}>
                  {remainingChars()}
                </span>
              </div>

              <div class="flex justify-end">
                <button
                  type="submit"
                  class="hidden sm:inline-flex px-6 py-2 rounded-full font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    "background-color": "var(--text)",
                    color: "var(--bg)",
                  }}
                  disabled={isDisabled()}
                >
                  {posting() ? "投稿中…" : "投稿"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}


