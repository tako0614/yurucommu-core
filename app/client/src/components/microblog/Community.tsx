import { createMemo, For } from "solid-js";
import type { Community, Note } from "./types.ts";
import { noteToPost } from "./types.ts";
import { PostList } from "./Post.tsx";
import { UserAvatar } from "./UserAvatar.tsx";

export function CommunityView(props: {
  showCommunityView: boolean;
  setShowCommunityView: (show: boolean) => void;
  selectedCommunity: Community | null;
  setSelectedCommunity: (community: Community | null) => void;
  showCreateCommunity: boolean;
  setShowCreateCommunity: (show: boolean) => void;
  communityName: string;
  setCommunityName: (name: string) => void;
  communityDescription: string;
  setCommunityDescription: (description: string) => void;
  communityAvatar: string;
  setCommunityAvatar: (avatar: string) => void;
  communityBanner: string;
  setCommunityBanner: (banner: string) => void;
  communityTags: string;
  setCommunityTags: (tags: string) => void;
  communityIsPrivate: boolean;
  setCommunityIsPrivate: (isPrivate: boolean) => void;
  communities: Community[];
  communityPosts: Note[];
  handleJoinCommunity: (communityId: string) => void;
  handleLeaveCommunity: (communityId: string) => void;
  handleCreateCommunity: (e: Event) => void;
  handleSelectCommunity: (community: Community) => void;
  handleLikeCommunityPost: (postId: string) => void;
  formatDate: (dateString: string) => string;
  handleReply: (postId: string) => void;
  handleRetweet: (postId: string) => void;
  handleQuote: (postId: string) => void;
  handleLike: (postId: string) => void;
  handleEdit: (id: string, current: string) => void;
  handleDelete: (id: string) => void;
}) {
  const communityPostsAsMicroblog = createMemo(() => {
    return props.communityPosts.map(noteToPost);
  });
  return (
    <>
      {/* コミュニティビュー（コミュニティタブが選択された時のみ表示） */}
      {
        <div class="p-4">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-2xl font-bold">コミュニティ</h2>
            <button
              type="button"
              onClick={() => props.setShowCreateCommunity(true)}
              class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full font-medium transition-colors"
            >
              新規作成
            </button>
          </div>

          {/* コミュニティ一覧 */}
          <div class="space-y-4">
            <For each={props.communities}>
              {(community) => (
                <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 hover:border-gray-700 transition-colors">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center space-x-3 mb-3">
                        <UserAvatar
                          avatarUrl={community.avatar}
                          username={community.name}
                          size="w-12 h-12"
                        />
                        <div>
                          <h3
                            class="text-lg font-bold text-white hover:text-blue-400 cursor-pointer"
                            onClick={() =>
                              props.handleSelectCommunity(community)}
                          >
                            {community.name}
                          </h3>
                          <div class="flex items-center space-x-4 text-sm text-gray-400">
                            <span>
                              {community.memberCount.toLocaleString()} メンバー
                            </span>
                            <span>
                              {community.postCount.toLocaleString()} 投稿
                            </span>
                            {community.isPrivate && (
                              <span class="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full text-xs">
                                非公開
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p class="text-gray-300 mb-3">{community.description}</p>
                      <div class="flex flex-wrap gap-2">
                        <For each={community.tags}>
                          {(tag) => (
                            <span class="bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full text-xs">
                              #{tag}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="ml-4">
                      {community.isJoined
                        ? (
                          <button
                            type="button"
                            onClick={() =>
                              props.handleLeaveCommunity(community.id)}
                            class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                          >
                            参加中
                          </button>
                        )
                        : (
                          <button
                            type="button"
                            onClick={() =>
                              props.handleJoinCommunity(community.id)}
                            class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition-colors"
                          >
                            参加する
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      }

      {/* 個別コミュニティビュー */}
      {
        <div class="p-4">
          {/* コミュニティヘッダー */}
          <div class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 mb-6">
            {/* バナー */}
            <div class="h-32 bg-gradient-to-r from-purple-600 to-pink-600">
            </div>

            {/* コミュニティ情報 */}
            <div class="p-6">
              <div class="flex items-start justify-between">
                <div class="flex items-center space-x-4">
                  <div class="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center -mt-8 border-4 border-gray-900">
                    <span class="text-white font-bold text-xl">
                      {props.selectedCommunity!.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h2 class="text-2xl font-bold text-white">
                      {props.selectedCommunity!.name}
                    </h2>
                    <div class="flex items-center space-x-4 text-sm text-gray-400 mt-1">
                      <span>
                        {props.selectedCommunity!.memberCount.toLocaleString()}
                        {" "}
                        メンバー
                      </span>
                      <span>
                        {props.selectedCommunity!.postCount.toLocaleString()}
                        {" "}
                        投稿
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      props.setSelectedCommunity(null);
                      props.setShowCommunityView(true);
                    }}
                    class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition-colors"
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
                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      />
                    </svg>
                  </button>
                  {props.selectedCommunity!.isJoined
                    ? (
                      <button
                        type="button"
                        onClick={() =>
                          props.handleLeaveCommunity(
                            props.selectedCommunity!.id,
                          )}
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                      >
                        参加中
                      </button>
                    )
                    : (
                      <button
                        type="button"
                        onClick={() =>
                          props.handleJoinCommunity(
                            props.selectedCommunity!.id,
                          )}
                        class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition-colors"
                      >
                        参加する
                      </button>
                    )}
                </div>
              </div>
              <p class="text-gray-300 mt-4">
                {props.selectedCommunity!.description}
              </p>
              <div class="flex flex-wrap gap-2 mt-4">
                <For each={props.selectedCommunity!.tags}>
                  {(tag) => (
                    <span class="bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full text-xs">
                      #{tag}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>

          {/* コミュニティ投稿 */}
          <PostList
            posts={communityPostsAsMicroblog()}
            tab="community"
            handleReply={props.handleReply}
            handleRetweet={props.handleRetweet}
            handleQuote={props.handleQuote}
            handleLike={props.handleLike}
            handleEdit={props.handleEdit}
            handleDelete={props.handleDelete}
            formatDate={props.formatDate}
          />
        </div>
      }
    </>
  );
}
