import { createResource, createSignal, For, Show } from "solid-js";
import { renderNoteContent } from "../../utils/render.ts";
import { getDomain } from "../../utils/config.ts";
import type { MicroblogPost } from "./types.ts";
import { UserAvatar } from "./UserAvatar.tsx";
import {
  fetchActivityPubActor,
  getCachedUserInfo,
  type UserInfo as _UserInfo,
} from "./api.ts";
import { fetchPostById } from "./api.ts";

interface OgpData {
  title?: string;
  description?: string;
  image?: string;
  url: string;
}

async function fetchOgpData(url: string): Promise<OgpData | null> {
  try {
    const response = await fetch(`/api/ogp?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      console.error("Failed to fetch OGP data:", response.statusText);
      return null;
    }
    const data = await response.json();
    return data as OgpData;
  } catch (error) {
    console.error("Error fetching OGP data:", error);
    return null;
  }
}

function OgpPreview(props: { url: string }) {
  const [ogp] = createResource(() => fetchOgpData(props.url));

  return (
    <Show when={ogp()} keyed>
      {(ogpData: OgpData) => (
        <a
          href={ogpData.url}
          target="_blank"
          rel="noopener noreferrer"
          class="block border border-gray-700 rounded-lg overflow-hidden mt-3 hover:bg-gray-800 transition-colors"
        >
          {ogpData.image && (
            <div class="w-full h-48 bg-gray-800 flex items-center justify-center overflow-hidden">
              <img
                src={ogpData.image}
                alt="OGP Image"
                class="w-full h-full object-cover"
              />
            </div>
          )}
          <div class="p-4">
            <p class="font-bold text-white text-lg mb-1 line-clamp-2">
              {ogpData.title}
            </p>
            {ogpData.description && (
              <p class="text-gray-400 text-sm line-clamp-3">
                {ogpData.description}
              </p>
            )}
            <p class="text-blue-400 text-sm mt-2 truncate">
              {ogpData.url}
            </p>
          </div>
        </a>
      )}
    </Show>
  );
}

function QuotedPost(props: { quoteId: string }) {
  const [post] = createResource(() => fetchPostById(props.quoteId));
  return (
    <Show when={post()}>
      <div class="border-l-2 border-gray-700 pl-3 text-sm mb-3">
        <div innerHTML={renderNoteContent({ content: post()!.content })} />
      </div>
    </Show>
  );
}

// ユーザー情報を整理する関数
function formatUserInfo(post: MicroblogPost) {
  // displayNameが空文字列やundefinedの場合、userNameから適切な表示名を生成
  let displayName = post.displayName;
  if (!displayName || displayName.trim() === "") {
    // userNameがURLの場合、ドメイン部分を除いてユーザー名を抽出
    if (post.userName.includes("@")) {
      displayName = post.userName.split("@")[0];
    } else if (post.userName.startsWith("http")) {
      // URLの場合、最後のパス部分を使用
      const urlParts = post.userName.split("/").filter(Boolean);
      displayName = urlParts.at(-1) || "External User";
    } else {
      displayName = post.userName;
    }
  }

  // domainの処理：自サーバーと外部サーバーを適切に区別
  let domain = post.domain;
  let userName = post.userName;

  if (post.userName.includes("@")) {
    // userName が user@domain 形式の場合
    const parts = post.userName.split("@");
    userName = parts[0];
    if (!domain && parts.length > 1) {
      domain = parts[1];
    }
  } else if (post.userName.startsWith("http")) {
    // userNameがURLの場合、ドメインを抽出
    try {
      const url = new URL(post.userName);
      domain = url.hostname;
      // URLの最後の部分をユーザー名として使用
      const pathParts = url.pathname.split("/").filter(Boolean);
      userName = pathParts.at(-1) || userName;
    } catch {
      // URL解析に失敗した場合のフォールバック
      domain = "external";
    }
  }

  // 自サーバーのドメインかどうかを判定（実際のサーバードメインに置き換えてください）
  const isLocalUser = !domain || domain === getDomain() ||
    domain === "localhost";

  return {
    displayName,
    userName: isLocalUser ? userName : `${userName}@${domain}`,
    domain: isLocalUser ? "" : domain,
    isLocalUser,
  };
}

type PostItemProps = {
  post: MicroblogPost;
  tab: "recommend" | "following" | "community";
  handleReply: (postId: string) => void;
  handleRetweet: (postId: string) => void;
  handleQuote: (postId: string) => void;
  handleLike: (postId: string) => void;
  handleEdit: (id: string, current: string) => void;
  handleDelete: (id: string) => void;
  formatDate: (dateString: string) => string;
  isReply?: boolean;
};

function PostItem(props: PostItemProps) {
  const {
    post,
    tab,
    handleReply,
    handleRetweet,
    handleQuote,
    handleLike,
    handleEdit,
    handleDelete,
    formatDate,
  } = props;

  // ユーザー情報を整理
  const userInfo = formatUserInfo(post);

  // 外部ユーザーの追加情報を取得
  type ExternalInfo = {
    displayName: string;
    avatarUrl?: string;
    authorAvatar?: string;
  };
  const [externalUserInfo] = createResource<ExternalInfo | null>(
    () => {
      if (
        !userInfo.isLocalUser && post.userName &&
        post.userName.startsWith("http")
      ) {
        // まずキャッシュを確認
        return getCachedUserInfo(post.userName).then((cached) =>
          cached ?? fetchActivityPubActor(post.userName)
        );
      }
      return Promise.resolve(null);
    },
  );

  // 最終的な表示情報を決定
  const finalUserInfo = () => {
    const external = externalUserInfo();
    if (!userInfo.isLocalUser && external) {
      // UserInfo型の場合とlegacy形式の場合を適切に処理
      const avatar = "authorAvatar" in external
        ? external.authorAvatar
        : external.avatarUrl;
      return {
        ...userInfo,
        displayName: external.displayName || userInfo.displayName,
        authorAvatar: avatar || post.authorAvatar,
      };
    }
    return {
      ...userInfo,
      authorAvatar: post.authorAvatar,
    };
  };

  const openPost = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a")) return;
    globalThis.location.hash = `#/post/${post.id}`;
  };

  return (
    <div
      class={`p-4 hover:bg-gray-950/50 transition-colors cursor-pointer ${
        props.isReply ? "border-l-2 border-gray-700 pl-6" : ""
      }`}
      onClick={openPost}
    >
      <div class="flex space-x-3">
        <div class="flex-shrink-0">
          <UserAvatar
            avatarUrl={finalUserInfo().authorAvatar}
            username={finalUserInfo().userName}
            size="w-12 h-12"
            isExternal={!userInfo.isLocalUser}
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-x-2 mb-1">
            <span class="font-bold text-white hover:underline cursor-pointer truncate">
              {finalUserInfo().displayName}
            </span>
            <span class="text-gray-500 truncate">
              @{finalUserInfo().userName}
            </span>
            <span class="text-gray-500">·</span>
            <a
              href={`#/post/${post.id}`}
              class="text-gray-500 text-sm whitespace-nowrap hover:underline"
            >
              {formatDate(post.createdAt)}
            </a>
          </div>
          <div
            class="text-white mb-3 leading-relaxed break-words overflow-hidden"
            innerHTML={renderNoteContent({ content: post.content })}
          />
          {post.attachments && post.attachments.length > 0 && (
            <div class="mb-3 grid gap-2 sm:grid-cols-2">
              <For each={post.attachments}>
                {(att) => (
                  <Show
                    when={att.type === "image"}
                    fallback={att.type === "video"
                      ? (
                        <video
                          src={att.url}
                          controls
                          class="max-w-full rounded"
                        />
                      )
                      : att.type === "audio"
                      ? <audio src={att.url} controls class="w-full" />
                      : null}
                  >
                    <img
                      src={att.url}
                      alt="attachment"
                      class="max-w-full rounded"
                    />
                  </Show>
                )}
              </For>
            </div>
          )}
          {post.quoteId && <QuotedPost quoteId={post.quoteId} />}
          {/* OGPプレビューの表示 */}
          {post.content.match(/<div data-og="(.*?)"><\/div>/) && (
            <OgpPreview
              url={post.content.match(/<div data-og="(.*?)"><\/div>/)![1]}
            />
          )}
          <div class="flex items-center justify-between max-w-md">
            <button
              type="button"
              onClick={() => handleReply(post.id)}
              class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group"
            >
              <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
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
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <span class="text-sm">{post.replies || 0}</span>
            </button>
            {tab !== "community" && (
              <button
                type="button"
                onClick={() => handleRetweet(post.id)}
                class={`flex items-center space-x-2 transition-colors group ${
                  post.isRetweeted
                    ? "text-green-400"
                    : "text-gray-500 hover:text-green-400"
                }`}
              >
                <div class="p-2 rounded-full group-hover:bg-green-400/10 transition-colors">
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <span class="text-sm">{post.retweets || 0}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleLike(post.id)}
              class={`flex items-center space-x-2 transition-colors group ${
                post.isLiked
                  ? "text-red-400"
                  : "text-gray-500 hover:text-red-400"
              }`}
            >
              <div class="p-2 rounded-full group-hover:bg-red-400/10 transition-colors">
                <svg
                  class="w-5 h-5"
                  fill={post.isLiked ? "currentColor" : "none"}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
              </div>
              <span class="text-sm">{post.likes || 0}</span>
            </button>
            {tab === "community" && (
              <div class="flex items-center space-x-2 text-purple-400">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z" />
                </svg>
                <span class="text-xs">コミュニティ投稿</span>
              </div>
            )}
            <button
              type="button"
              class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group"
              onClick={() => handleQuote(post.id)}
            >
              <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
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
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
                  />
                </svg>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleEdit(post.id, post.content)}
              class="flex items-center space-x-2 text-gray-500 hover:text-yellow-400 transition-colors group"
            >
              <div class="p-2 rounded-full group-hover:bg-yellow-400/10 transition-colors">
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
                    d="M4 21h16M4 17l6-6M16 5l3 3-6 6-3-3-6 6"
                  />
                </svg>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleDelete(post.id)}
              class="flex items-center space-x-2 text-gray-500 hover:text-red-400 transition-colors group"
            >
              <div class="p-2 rounded-full group-hover:bg-red-400/10 transition-colors">
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
                    d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7z"
                  />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PostList(props: {
  posts: MicroblogPost[];
  tab: "recommend" | "following" | "community";
  handleReply: (postId: string) => void;
  handleRetweet: (postId: string) => void;
  handleQuote: (postId: string) => void;
  handleLike: (postId: string) => void;
  handleEdit: (id: string, current: string) => void;
  handleDelete: (id: string) => void;
  formatDate: (dateString: string) => string;
  isThread?: boolean;
}) {
  return (
    <div class="divide-y divide-gray-800">
      <For each={props.posts}>
        {(post, i) => (
          <PostItem
            post={post}
            tab={props.tab}
            handleReply={props.handleReply}
            handleRetweet={props.handleRetweet}
            handleQuote={props.handleQuote}
            handleLike={props.handleLike}
            handleEdit={props.handleEdit}
            handleDelete={props.handleDelete}
            formatDate={props.formatDate}
            isReply={props.isThread && i() > 0}
          />
        )}
      </For>
    </div>
  );
}

export function PostForm(props: {
  showPostForm: boolean;
  setShowPostForm: (show: boolean) => void;
  newPostContent: string;
  setNewPostContent: (content: string) => void;
  handleSubmit: (e: Event) => void;
  attachments: { url: string; type: "image" | "video" | "audio" }[];
  setAttachments: (
    a: { url: string; type: "image" | "video" | "audio" }[],
  ) => void;
  replyingTo?: string | null;
  quoteId?: string | null;
  currentUser?: { userName: string; avatar?: string };
}) {
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
  const emojis = [
    "😀",
    "😂",
    "🥰",
    "😎",
    "🤔",
    "👍",
    "❤️",
    "🔥",
    "✨",
    "🎉",
    "💯",
    "🚀",
  ];

  let fileInput: HTMLInputElement | undefined;

  const handleFileChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    if (!target.files) return;
    const files = Array.from(target.files);
    const newAtt: { url: string; type: "image" | "video" | "audio" }[] = [];
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const type = f.type.startsWith("video")
        ? "video"
        : f.type.startsWith("audio")
        ? "audio"
        : "image";
      newAtt.push({ url, type });
    }
    props.setAttachments([...props.attachments, ...newAtt]);
    if (fileInput) fileInput.value = "";
  };

  const insertEmoji = (emoji: string) => {
    props.setNewPostContent(props.newPostContent + emoji);
    setShowEmojiPicker(false);
  };

  return (
    <>
      {props.showPostForm && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-gray-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-700">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold">新しいツイート</h2>
              <button
                type="button"
                onClick={() => props.setShowPostForm(false)}
                class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={props.handleSubmit} class="space-y-4">
              {(props.replyingTo || props.quoteId) && (
                <div class="text-sm text-gray-400">
                  {props.replyingTo && <span>返信先: {props.replyingTo}</span>}
                  {props.quoteId && (
                    <span class="ml-2">引用: {props.quoteId}</span>
                  )}
                </div>
              )}
              <div class="flex space-x-3">
                <UserAvatar
                  avatarUrl={props.currentUser?.avatar}
                  username={props.currentUser?.userName || "User"}
                  size="w-12 h-12"
                />
                <div class="flex-1">
                  <textarea
                    value={props.newPostContent}
                    onInput={(e) =>
                      props.setNewPostContent(e.currentTarget.value)}
                    placeholder=""
                    maxlength={280}
                    class="w-full bg-transparent text-xl placeholder-gray-500 resize-none border-none outline-none"
                    rows={4}
                  />
                  {props.attachments.length > 0 && (
                    <div class="mt-2 grid gap-2 sm:grid-cols-2">
                      <For each={props.attachments}>
                        {(att, i) => (
                          <div class="relative">
                            <Show
                              when={att.type === "image"}
                              fallback={att.type === "video"
                                ? (
                                  <video
                                    src={att.url}
                                    controls
                                    class="max-w-full rounded"
                                  />
                                )
                                : att.type === "audio"
                                ? (
                                  <audio
                                    src={att.url}
                                    controls
                                    class="w-full"
                                  />
                                )
                                : null}
                            >
                              <img
                                src={att.url}
                                alt="attachment"
                                class="max-w-full rounded"
                              />
                            </Show>
                            <button
                              type="button"
                              class="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                              onClick={() => {
                                const arr = [...props.attachments];
                                arr.splice(i(), 1);
                                props.setAttachments(arr);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                  <button
                    type="button"
                    onClick={() => fileInput?.click()}
                    class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors"
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
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <input
                      ref={(el) => (fileInput = el)}
                      type="file"
                      multiple
                      accept="image/*,video/*,audio/*"
                      class="hidden"
                      onChange={handleFileChange}
                    />
                  </button>
                  <div class="relative">
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker())}
                      class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors"
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
                          d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </button>
                    {showEmojiPicker() && (
                      <div class="absolute bottom-full mb-2 bg-gray-800 rounded-lg p-3 shadow-lg border border-gray-700 grid grid-cols-6 gap-2">
                        <For each={emojis}>
                          {(emoji) => (
                            <button
                              type="button"
                              onClick={() => insertEmoji(emoji)}
                              class="text-xl hover:bg-gray-700 p-1 rounded transition-colors"
                            >
                              {emoji}
                            </button>
                          )}
                        </For>
                      </div>
                    )}
                  </div>
                </div>

                <div class="flex items-center space-x-3">
                  <span
                    class={`text-sm ${
                      props.newPostContent.length > 260
                        ? "text-red-400"
                        : props.newPostContent.length > 240
                        ? "text-yellow-400"
                        : "text-gray-500"
                    }`}
                  >
                    {props.newPostContent.length > 0 && (
                      <div class="relative w-8 h-8">
                        <svg
                          class="w-8 h-8 transform -rotate-90"
                          viewBox="0 0 32 32"
                        >
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            stroke="currentColor"
                            stroke-width="2"
                            fill="none"
                            class="text-gray-700"
                          />
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            stroke="currentColor"
                            stroke-width="2"
                            fill="none"
                            stroke-dasharray={`${
                              (props.newPostContent.length / 280) * 88
                            } 88`}
                            class={props.newPostContent.length > 260
                              ? "text-red-400"
                              : props.newPostContent.length > 240
                              ? "text-yellow-400"
                              : "text-blue-400"}
                          />
                        </svg>
                        {props.newPostContent.length > 240 && (
                          <span class="absolute inset-0 flex items-center justify-center text-xs font-bold">
                            {280 - props.newPostContent.length}
                          </span>
                        )}
                      </div>
                    )}
                  </span>
                  <button
                    type="submit"
                    class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                      !props.newPostContent.trim() ||
                        props.newPostContent.length > 280
                        ? "bg-blue-400/50 text-white/50 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                    }`}
                    disabled={!props.newPostContent.trim() ||
                      props.newPostContent.length > 280}
                  >
                    ツイートする
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
