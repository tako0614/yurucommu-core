import { createSignal, For, Show } from "solid-js";
import type { MicroblogPost } from "./types.ts";
import { PostItem } from "./Post.tsx";

type PostDetailViewProps = {
  post: MicroblogPost;
  replies: MicroblogPost[];
  onBack: () => void;
  onReplySubmit: (
    content: string,
    attachments: { url: string; type: "image" | "video" | "audio" }[],
  ) => Promise<void>;
  handleLike: (id: string) => void;
  handleRetweet: (id: string) => void;
  handleQuote: (id: string) => void;
  handleEdit: (id: string, current: string) => void;
  handleDelete: (id: string) => void;
  formatDate: (dateString: string) => string;
};

export function PostDetailView(props: PostDetailViewProps) {
  const [replyText, setReplyText] = createSignal("");
  const [attachments, setAttachments] = createSignal<
    { url: string; type: "image" | "video" | "audio" }[]
  >([]);
  const [addingAttachment, setAddingAttachment] = createSignal(false);
  const [attUrl, setAttUrl] = createSignal("");
  const [attType, setAttType] = createSignal<"image" | "video" | "audio">(
    "image",
  );
  const [submitting, setSubmitting] = createSignal(false);

  const onSubmitReply = async (e: Event) => {
    e.preventDefault();
    if (!replyText().trim() && attachments().length === 0) return;
    try {
      setSubmitting(true);
      await props.onReplySubmit(replyText().trim(), attachments());
      setReplyText("");
      setAttachments([]);
    } finally {
      setSubmitting(false);
    }
  };

  const addAttachment = () => {
    const url = attUrl().trim();
    if (!url) return;
    setAttachments((prev) => [...prev, { url, type: attType() }]);
    setAttUrl("");
    setAttType("image");
    setAddingAttachment(false);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div class="text-[#E6E7EA] max-w-2xl mx-auto lg:mt-4 backdrop-blur-sm rounded-xl border border-[#2B3340]/50 lg:h-[calc(100vh-2rem)] lg:overflow-hidden lg:flex lg:flex-col bg-[#0F141A]/60">
      {/* ヘッダー（戻る） */}
      <div class="sticky top-0 z-10 bg-[#0F141A]/95 backdrop-blur-lg border-b border-[#2B3340]/50 rounded-t-xl">
        <div class="px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={props.onBack}
            class="text-[#9CA3AF] hover:text-[#E5E7EB] flex items-center gap-2"
            aria-label="戻る"
          >
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span class="font-semibold">ポスト</span>
          </button>
        </div>
      </div>

      {/* 元ポスト */}
      <div class="px-4 border-b border-[#2B3340]/50">
        <PostItem
          post={props.post}
          tab="latest"
          handleReply={() => {}}
          handleLike={props.handleLike}
          handleRetweet={props.handleRetweet}
          handleQuote={props.handleQuote}
          handleEdit={props.handleEdit}
          handleDelete={props.handleDelete}
          formatDate={props.formatDate}
        />
      </div>

      {/* 返信フォーム */}
      <div class="px-4 py-3 border-b border-[#2B3340]/50">
        <form onSubmit={onSubmitReply} class="flex flex-col gap-3">
          <textarea
            class="w-full bg-transparent border border-[#2B3340]/60 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            rows={3}
            placeholder="返信をポスト"
            value={replyText()}
            onInput={(e) =>
              setReplyText((e.currentTarget as HTMLTextAreaElement).value)}
          />

          {/* 添付プレビュー */}
          <Show when={attachments().length > 0}>
            <div class="flex flex-wrap gap-2">
              <For each={attachments()}>
                {(att, i) => (
                  <div class="flex items-center gap-2 border border-[#2B3340]/60 rounded-lg px-2 py-1">
                    <span class="text-xs text-gray-300">{att.type}</span>
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      class="max-w-[200px] truncate text-[#60A5FA] hover:underline"
                    >
                      {att.url}
                    </a>
                    <button
                      type="button"
                      class="ml-1 text-gray-400 hover:text-red-400"
                      onClick={() => removeAttachment(i())}
                      aria-label="添付を削除"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* 添付追加UI（URL/タイプ） */}
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-[#60A5FA] hover:text-[#93C5FD]"
              onClick={() => setAddingAttachment((v) => !v)}
            >
              添付を追加
            </button>
            <Show when={addingAttachment()}>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="メディアのURL"
                  class="min-w-[220px] bg-transparent border border-[#2B3340]/60 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  value={attUrl()}
                  onInput={(e) =>
                    setAttUrl((e.currentTarget as HTMLInputElement).value)}
                />
                <select
                  class="bg-transparent border border-[#2B3340]/60 rounded-lg px-2 py-1"
                  value={attType()}
                  onChange={(e) =>
                    setAttType(
                      (e.currentTarget as HTMLSelectElement)
                        .value as "image" | "video" | "audio",
                    )}
                >
                  <option value="image">画像</option>
                  <option value="video">動画</option>
                  <option value="audio">音声</option>
                </select>
                <button
                  type="button"
                  onClick={addAttachment}
                  class="px-3 py-1 rounded-lg bg-[#2563EB] hover:bg-[#3B82F6]"
                >
                  追加
                </button>
              </div>
            </Show>
            <div class="ml-auto flex items-center gap-2">
              <span class="text-xs text-gray-400">{replyText().length}</span>
              <button
                type="submit"
                disabled={submitting() ||
                  (!replyText().trim() && attachments().length === 0)}
                class="px-4 py-2 rounded-full bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#3B82F6]"
              >
                {submitting() ? "送信中…" : "返信"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* 返信一覧 */}
      <div class="flex-1 overflow-y-auto divide-y divide-[#2B3340]/50">
        <div class="px-4 py-2 text-sm text-[#9CA3AF]">返信</div>
        <For each={props.replies}>
          {(reply) => (
            <PostItem
              post={reply}
              tab="latest"
              isReply
              handleReply={() => {}}
              handleLike={props.handleLike}
              handleRetweet={props.handleRetweet}
              handleQuote={props.handleQuote}
              handleEdit={props.handleEdit}
              handleDelete={props.handleDelete}
              formatDate={props.formatDate}
            />
          )}
        </For>
      </div>
    </div>
  );
}
