import { For } from "solid-js";
import type { Community, CommunityPost } from "./types.ts";

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
  communityPosts: CommunityPost[];
  handleJoinCommunity: (communityId: string) => void;
  handleLeaveCommunity: (communityId: string) => void;
  handleCreateCommunity: (e: Event) => void;
  handleSelectCommunity: (community: Community) => void;
  handleLikeCommunityPost: (postId: string) => void;
  formatDate: (dateString: string) => string;
}) {
  return (
    <>
      {/* コミュニティビュー（コミュニティタブが選択された時のみ表示） */}
      {props.showCommunityView && !props.selectedCommunity && (
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
                        <div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                          <span class="text-white font-bold text-lg">
                            {community.name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <h3 class="text-lg font-bold text-white hover:text-blue-400 cursor-pointer" 
                              onClick={() => props.handleSelectCommunity(community)}>
                            {community.name}
                          </h3>
                          <div class="flex items-center space-x-4 text-sm text-gray-400">
                            <span>{community.memberCount.toLocaleString()} メンバー</span>
                            <span>{community.postCount.toLocaleString()} 投稿</span>
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
                      {community.isJoined ? (
                        <button
                          type="button"
                          onClick={() => props.handleLeaveCommunity(community.id)}
                          class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                        >
                          参加中
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => props.handleJoinCommunity(community.id)}
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
      )}

      {/* 個別コミュニティビュー */}
      {props.showCommunityView && props.selectedCommunity && (
        <div class="p-4">
          {/* コミュニティヘッダー */}
          <div class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 mb-6">
            {/* バナー */}
            <div class="h-32 bg-gradient-to-r from-purple-600 to-pink-600"></div>
            
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
                    <h2 class="text-2xl font-bold text-white">{props.selectedCommunity!.name}</h2>
                    <div class="flex items-center space-x-4 text-sm text-gray-400 mt-1">
                      <span>{props.selectedCommunity!.memberCount.toLocaleString()} メンバー</span>
                      <span>{props.selectedCommunity!.postCount.toLocaleString()} 投稿</span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {props.setSelectedCommunity(null); props.setShowCommunityView(true);}}
                    class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition-colors"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  {props.selectedCommunity!.isJoined ? (
                    <button
                      type="button"
                      onClick={() => props.handleLeaveCommunity(props.selectedCommunity!.id)}
                      class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                    >
                      参加中
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => props.handleJoinCommunity(props.selectedCommunity!.id)}
                      class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition-colors"
                    >
                      参加する
                    </button>
                  )}
                </div>
              </div>
              <p class="text-gray-300 mt-4">{props.selectedCommunity!.description}</p>
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
          <div class="space-y-4">
            <For each={props.communityPosts.filter(post => post.communityId === props.selectedCommunity!.id)}>
              {(post) => (
                <div class={`bg-gray-900 rounded-xl p-6 border border-gray-800 ${post.isPinned ? 'border-yellow-500/50' : ''}`}>
                  {post.isPinned && (
                    <div class="flex items-center space-x-2 mb-3 text-yellow-400">
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                        <path fill-rule="evenodd" d="M3 8a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
                        <path d="M8 15v-2a1 1 0 112 0v2h2a1 1 0 110 2H8a1 1 0 110-2h0z" />
                      </svg>
                      <span class="text-sm font-medium">ピン留め投稿</span>
                    </div>
                  )}
                  <div class="flex space-x-3">
                    <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span class="text-white font-bold text-sm">
                        {post.author.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div class="flex-1">
                      <div class="flex items-center space-x-2 mb-2">
                        <span class="font-bold text-white">{post.author}</span>
                        <span class="text-gray-500">·</span>
                        <span class="text-gray-500 text-sm">{props.formatDate(post.createdAt)}</span>
                      </div>
                      <div class="text-white mb-4 leading-relaxed">{post.content}</div>
                      <div class="flex items-center space-x-6">
                        <button
                          type="button"
                          onClick={() => props.handleLikeCommunityPost(post.id)}
                          class={`flex items-center space-x-2 transition-colors group ${
                            post.isLiked ? "text-red-400" : "text-gray-500 hover:text-red-400"
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
                          <span class="text-sm">{post.likes}</span>
                        </button>
                        <button
                          type="button"
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
                          <span class="text-sm">{post.comments}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      )}
    </>
  );
}
