import { createEffect, createResource, createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import Avatar from "../components/Avatar";
import { api, uploadMedia, useMe, createPostPlan, updatePostPlan, getPostPlan, listPostPlans, deletePostPlan } from "../lib/api";

export default function Compose() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedCommunity, setSelectedCommunity] = createSignal<string>("");
  const [text, setText] = createSignal("");
  const [selectedImages, setSelectedImages] = createSignal<File[]>([]);
  const [imagePreviews, setImagePreviews] = createSignal<string[]>([]);
  const [uploadedMediaUrls, setUploadedMediaUrls] = createSignal<string[]>([]);
  const [posting, setPosting] = createSignal(false);
  const [audience, setAudience] = createSignal<"community" | "all">("all");
  const [showDrafts, setShowDrafts] = createSignal(false);
  const [currentDraftId, setCurrentDraftId] = createSignal<string | null>(null);
  const [saveStatus, setSaveStatus] = createSignal<"" | "saving" | "saved" | "error">("");
  const [scheduledAt, setScheduledAt] = createSignal<string>("");
  const [showScheduler, setShowScheduler] = createSignal(false);
  const [communities] = createResource(async () =>
    api("/me/communities").catch(() => [])
  );
  const [drafts, { refetch: refetchDrafts }] = createResource(async () => {
    try {
      return await listPostPlans("draft");
    } catch {
      return [];
    }
  });
  const me = useMe();

  const maxLength = 280;
  const remainingChars = () => maxLength - text().length;
  const isOverLimit = () => remainingChars() < 0;
  const isNearLimit = () => remainingChars() >= 0 && remainingChars() < 20;
  const isDisabled = () =>
    (!text().trim() && selectedImages().length === 0 && uploadedMediaUrls().length === 0) ||
    isOverLimit() ||
    posting();

  // Load draft from URL parameter
  onMount(async () => {
    const draftId = searchParams.draft;
    if (draftId) {
      try {
        const draft = await getPostPlan(draftId);
        if (draft && draft.status === "draft") {
          setText(draft.text || "");
          setCurrentDraftId(draft.id);
          if (draft.community_id) {
            setSelectedCommunity(draft.community_id);
          }
          if (draft.media_urls && draft.media_urls.length > 0) {
            setUploadedMediaUrls(draft.media_urls);
          }
          if (draft.scheduled_at) {
            setScheduledAt(draft.scheduled_at);
          }
          setSaveStatus("saved");
        }
      } catch (err) {
        console.error("Failed to load draft:", err);
      }
    }
  });

  // Auto-save draft
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const t = text();
    const hasContent = t.trim() || selectedImages().length > 0 || uploadedMediaUrls().length > 0;

    if (!hasContent) return;

    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
      await saveDraft();
    }, 2000);
  });

  const saveDraft = async () => {
    const t = text().trim();
    const mediaUrls = uploadedMediaUrls();

    if (!t && selectedImages().length === 0 && mediaUrls.length === 0) return;

    setSaveStatus("saving");
    try {
      // Upload pending images first
      const newMediaUrls: string[] = [];
      for (const file of selectedImages()) {
        try {
          const url = await uploadMedia(file);
          newMediaUrls.push(url);
        } catch (err) {
          console.error("Failed to upload image:", err);
        }
      }

      const allMediaUrls = [...mediaUrls, ...newMediaUrls];
      setUploadedMediaUrls(allMediaUrls);
      setSelectedImages([]);
      setImagePreviews([]);

      const payload = {
        type: allMediaUrls.length > 0 ? "image" : "text",
        text: t,
        media_urls: allMediaUrls,
        community_id: selectedCommunity() || null,
        broadcast_all: audience() === "all",
        visible_to_friends: audience() === "all",
        scheduled_at: scheduledAt() || null,
      };

      if (currentDraftId()) {
        await updatePostPlan(currentDraftId()!, payload);
      } else {
        const created = await createPostPlan(payload);
        setCurrentDraftId(created.id);
      }

      setSaveStatus("saved");
      refetchDrafts();
    } catch (err) {
      console.error("Failed to save draft:", err);
      setSaveStatus("error");
    }
  };

  const loadDraft = async (draftId: string) => {
    try {
      const draft = await getPostPlan(draftId);
      if (draft) {
        setText(draft.text || "");
        setCurrentDraftId(draft.id);
        if (draft.community_id) {
          setSelectedCommunity(draft.community_id);
        }
        if (draft.media_urls && draft.media_urls.length > 0) {
          setUploadedMediaUrls(draft.media_urls);
        }
        if (draft.scheduled_at) {
          setScheduledAt(draft.scheduled_at);
        }
        setShowDrafts(false);
        setSaveStatus("saved");
      }
    } catch (err) {
      console.error("Failed to load draft:", err);
      alert("下書きの読み込みに失敗しました");
    }
  };

  const deleteDraftById = async (draftId: string) => {
    if (!confirm("この下書きを削除しますか？")) return;

    try {
      await deletePostPlan(draftId);
      if (currentDraftId() === draftId) {
        setCurrentDraftId(null);
        setText("");
        setUploadedMediaUrls([]);
        setSaveStatus("");
      }
      refetchDrafts();
    } catch (err) {
      console.error("Failed to delete draft:", err);
      alert("下書きの削除に失敗しました");
    }
  };

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

  const removeUploadedMedia = (index: number) => {
    const newUrls = uploadedMediaUrls().filter((_, i) => i !== index);
    setUploadedMediaUrls(newUrls);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    const t = text().trim();
    const mediaUrls = uploadedMediaUrls();
    const scheduled = scheduledAt();

    if (!t && selectedImages().length === 0 && mediaUrls.length === 0) return;

    setPosting(true);
    try {
      // Upload any remaining images
      const newMediaUrls: string[] = [];
      for (const file of selectedImages()) {
        newMediaUrls.push(await uploadMedia(file));
      }

      const allMediaUrls = [...mediaUrls, ...newMediaUrls];

      // If scheduled, save as scheduled post-plan
      if (scheduled) {
        const payload = {
          type: allMediaUrls.length > 0 ? "image" : "text",
          text: t,
          media_urls: allMediaUrls,
          community_id: selectedCommunity() || null,
          broadcast_all: audience() === "all",
          visible_to_friends: audience() === "all",
          scheduled_at: scheduled,
        };

        if (currentDraftId()) {
          await updatePostPlan(currentDraftId()!, { ...payload, status: "scheduled" as any });
        } else {
          await createPostPlan(payload);
        }

        alert(`投稿を ${new Date(scheduled).toLocaleString()} に予約しました`);
        setText("");
        setSelectedImages([]);
        setImagePreviews([]);
        setUploadedMediaUrls([]);
        setSelectedCommunity("");
        setAudience("all");
        setCurrentDraftId(null);
        setScheduledAt("");
        setSaveStatus("");
        navigate("/");
        return;
      }

      // Immediate post
      const cid = selectedCommunity();
      const postData = {
        text: t,
        type: allMediaUrls.length > 0 ? "image" : "text",
        media_urls: allMediaUrls,
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

      // Delete the draft after successful post
      if (currentDraftId()) {
        try {
          await deletePostPlan(currentDraftId()!);
        } catch {
          // Ignore draft deletion errors
        }
      }

      setText("");
      setSelectedImages([]);
      setImagePreviews([]);
      setUploadedMediaUrls([]);
      setSelectedCommunity("");
      setAudience("all");
      setCurrentDraftId(null);
      setScheduledAt("");
      setSaveStatus("");
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
      <div class="flex items-center justify-between mb-4">
        <div class="text-[17px] font-semibold text-gray-900 dark:text-white">
          投稿を作成
        </div>
        <div class="flex items-center gap-3">
          {saveStatus() && (
            <span class={`text-sm ${saveStatus() === "saved" ? "text-green-600" : saveStatus() === "saving" ? "text-blue-600" : "text-red-600"}`}>
              {saveStatus() === "saved" ? "保存済み" : saveStatus() === "saving" ? "保存中..." : "保存失敗"}
            </span>
          )}
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
            onClick={() => setShowDrafts(!showDrafts())}
          >
            下書き ({drafts()?.length || 0})
          </button>
        </div>
      </div>

      {showDrafts() && (
        <div class="mb-4 bg-white dark:bg-[#111] border border-gray-200/80 dark:border-white/10 rounded-[20px] p-4 shadow-sm">
          <div class="text-sm font-semibold mb-3">下書き一覧</div>
          <Show when={(drafts()?.length || 0) > 0} fallback={
            <div class="text-sm text-gray-500">下書きはありません</div>
          }>
            <div class="space-y-2">
              <For each={drafts()}>
                {(draft: any) => (
                  <div class="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800">
                    <div class="flex-1 min-w-0">
                      <div class="text-sm text-gray-900 dark:text-white truncate">
                        {draft.text || "(空の下書き)"}
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        {new Date(draft.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => loadDraft(draft.id)}
                      >
                        読込
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700"
                        onClick={() => deleteDraftById(draft.id)}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}

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

          {(imagePreviews().length > 0 || uploadedMediaUrls().length > 0) && (
            <div class="grid grid-cols-2 gap-3">
              <For each={uploadedMediaUrls()}>
                {(url, index) => (
                  <div class="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <img
                      src={url}
                      alt={`アップロード済み${index() + 1}`}
                      class="w-full h-32 object-cover"
                    />
                    <button
                      type="button"
                      class="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/70"
                      onClick={() => removeUploadedMedia(index())}
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
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

              <button
                type="button"
                class="w-10 h-10 rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white flex items-center justify-center transition-colors hover:bg-black/15 dark:hover:bg-white/20"
                onClick={() => setShowScheduler(!showScheduler())}
                title="スケジュール投稿"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
            </div>

            <span class={`text-sm ${charCountClass()}`}>
              {remainingChars()}
            </span>
          </div>

          {showScheduler() && (
            <div class="flex flex-col gap-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-200">
                投稿日時を指定
              </label>
              <input
                type="datetime-local"
                class="px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                value={scheduledAt()}
                onInput={(e) => setScheduledAt((e.target as HTMLInputElement).value)}
                min={new Date().toISOString().slice(0, 16)}
              />
              {scheduledAt() && (
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-600 dark:text-gray-400">
                    {new Date(scheduledAt()).toLocaleString()} に投稿予定
                  </span>
                  <button
                    type="button"
                    class="text-xs text-red-600 hover:text-red-700"
                    onClick={() => setScheduledAt("")}
                  >
                    クリア
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div class="flex justify-between">
          <button
            type="button"
            class="px-6 py-2 rounded-full font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            onClick={saveDraft}
          >
            下書き保存
          </button>
          <button
            class="px-6 py-2 rounded-full font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              "background-color": "var(--text)",
              color: "var(--bg)",
            }}
            disabled={isDisabled()}
            aria-label={scheduledAt() ? "スケジュール投稿" : "投稿"}
          >
            {posting() ? (scheduledAt() ? "予約中..." : "投稿中...") : (scheduledAt() ? "予約投稿" : "投稿")}
          </button>
        </div>
      </form>
    </div>
  );
}
