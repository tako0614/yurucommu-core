import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import Avatar from "../components/Avatar";
import { api, uploadMedia, useMe } from "../lib/api";

export default function Compose() {
  const navigate = useNavigate();
  const [selectedCommunity, setSelectedCommunity] = createSignal<string>("");
  const [text, setText] = createSignal("");
  const [selectedImages, setSelectedImages] = createSignal<File[]>([]);
  const [imagePreviews, setImagePreviews] = createSignal<string[]>([]);
  const [posting, setPosting] = createSignal(false);
  const [audience, setAudience] = createSignal<"community" | "all">("all");
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
      const mediaUrls: string[] = [];
      for (const file of selectedImages()) {
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

      setText("");
      setSelectedImages([]);
      setImagePreviews([]);
      setSelectedCommunity("");
      setAudience("all");
      navigate("/");
    } catch (err) {
      console.error(err);
      if (err instanceof Error) {
        alert(err.message || "投稿に失敗しました");
      } else {
        alert("投稿に失敗しました");
      }
    } finally {
      setPosting(false);
    }
  };

  const user = () => me() as any;
  const charCountClass = () =>
    isOverLimit()
      ? "text-red-500"
      : isNearLimit()
      ? "text-amber-500"
      : "text-gray-500 dark:text-gray-400";

  return (
    <div class="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-6">
      <div class="text-[17px] font-semibold text-gray-900 dark:text-white mb-4">
        投稿を作成
      </div>
      <form
        class="flex flex-col gap-5 bg-white dark:bg-[#111] border border-gray-200/80 dark:border-white/10 rounded-[20px] p-6 shadow-sm"
        onSubmit={submit}
      >
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

        <div class="flex flex-col gap-4">
          <textarea
            class="w-full min-h-[120px] resize-none border-none outline-none bg-transparent text-[18px] leading-6 placeholder:text-gray-500 dark:placeholder:text-gray-400"
            placeholder="何を投稿しますか？"
            value={text()}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            maxlength={maxLength}
          />

          {imagePreviews().length > 0 && (
            <div class="grid grid-cols-2 gap-3">
              <For each={imagePreviews()}>
                {(preview, index) => (
                  <div class="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <img
                      src={preview}
                      alt={`プレビュー${index() + 1}`}
                      class="w-full h-32 object-cover"
                    />
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
          )}

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2 sm:gap-3">
              <label class="w-10 h-10 rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white flex items-center justify-center cursor-pointer transition-colors hover:bg-black/15 dark:hover:bg-white/20">
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  class="hidden"
                  onChange={handleImageSelect}
                />
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
                <svg
                  class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
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
        </div>

        <div class="flex justify-end">
          <button
            class="px-6 py-2 rounded-full font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              "background-color": "var(--text)",
              color: "var(--bg)",
            }}
            disabled={isDisabled()}
            aria-label="投稿"
          >
            {posting() ? "投稿中..." : "投稿"}
          </button>
        </div>
      </form>
    </div>
  );
}
