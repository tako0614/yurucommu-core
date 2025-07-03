import { createSignal, createResource, For } from "solid-js";

interface MicroblogPost {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

const fetchPosts = async (): Promise<MicroblogPost[]> => {
  try {
    const response = await fetch('/api/microblog');
    if (!response.ok) {
      throw new Error('Failed to fetch posts');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching posts:', error);
    return [];
  }
};

const createPost = async (content: string): Promise<boolean> => {
  try {
    const response = await fetch('/api/microblog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ author: 'user', content }),
    });
    return response.ok;
  } catch (error) {
    console.error('Error creating post:', error);
    return false;
  }
};

export function Microblog() {
  const [newPostContent, setNewPostContent] = createSignal("");
  const [posts, { refetch }] = createResource(fetchPosts);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = newPostContent().trim();
    if (!content) return;

    const success = await createPost(content);
    if (success) {
      setNewPostContent("");
      refetch();
    } else {
      alert("投稿の作成に失敗しました");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ja-JP');
  };


  return (
    <div class="min-h-screen text-white">
      {/* ヘッダー */}
      <div class="sticky top-0 z-10 backdrop-blur-md border-b border-gray-800">
        <div class="max-w-2xl mx-auto px-4 py-4">
          <h1 class="text-xl font-bold">ホーム</h1>
        </div>
      </div>

      <div class="max-w-2xl mx-auto">
        {/* 新しい投稿フォーム */}
        <div class="border-b border-gray-800 p-4">
          <form onSubmit={handleSubmit} class="space-y-4">
            <div class="flex space-x-3">
              <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1">
                <textarea
                  value={newPostContent()}
                  onInput={(e) => setNewPostContent(e.currentTarget.value)}
                  placeholder="いまどうしてる？"
                  maxlength={280}
                  class="w-full bg-transparent text-xl placeholder-gray-500 resize-none border-none outline-none"
                  rows={3}
                />
              </div>
            </div>
            
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-4">
                <button type="button" class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <button type="button" class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4V2a1 1 0 011-1h4a1 1 0 011 1v2h4a1 1 0 011 1v2a1 1 0 01-1 1h-1v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8H3a1 1 0 01-1-1V5a1 1 0 011-1h4z" />
                  </svg>
                </button>
              </div>
              
              <div class="flex items-center space-x-3">
                <span class={`text-sm ${newPostContent().length > 260 ? 'text-red-400' : newPostContent().length > 240 ? 'text-yellow-400' : 'text-gray-500'}`}>
                  {newPostContent().length > 0 && (
                    <div class="relative w-8 h-8">
                      <svg class="w-8 h-8 transform -rotate-90" viewBox="0 0 32 32">
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
                          stroke-dasharray={`${(newPostContent().length / 280) * 88} 88`}
                          class={newPostContent().length > 260 ? 'text-red-400' : newPostContent().length > 240 ? 'text-yellow-400' : 'text-blue-400'}
                        />
                      </svg>
                      {newPostContent().length > 240 && (
                        <span class="absolute inset-0 flex items-center justify-center text-xs font-bold">
                          {280 - newPostContent().length}
                        </span>
                      )}
                    </div>
                  )}
                </span>
                <button 
                  type="submit" 
                  class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                    !newPostContent().trim() || newPostContent().length > 280
                      ? 'bg-blue-400/50 text-white/50 cursor-not-allowed'
                      : 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
                  }`}
                  disabled={!newPostContent().trim() || newPostContent().length > 280}
                >
                  ツイートする
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* 投稿一覧 */}
        <div class="divide-y divide-gray-800">
          <For each={posts()}>
            {(post) => (
              <div class="p-4 hover:bg-gray-950/50 transition-colors cursor-pointer">
                <div class="flex space-x-3">
                  <div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-white font-bold text-sm">
                      {post.author.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 mb-1">
                      <span class="font-bold text-white hover:underline cursor-pointer">
                        {post.author}
                      </span>
                      <span class="text-gray-500">·</span>
                      <span class="text-gray-500 text-sm">
                        {formatDate(post.createdAt)}
                      </span>
                    </div>
                    
                    <div class="text-white mb-3 leading-relaxed">
                      {post.content}
                    </div>
                    
                    <div class="flex items-center justify-between max-w-md">
                      <button type="button" class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group">
                        <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </div>
                        <span class="text-sm">12</span>
                      </button>
                      
                      <button type="button" class="flex items-center space-x-2 text-gray-500 hover:text-green-400 transition-colors group">
                        <div class="p-2 rounded-full group-hover:bg-green-400/10 transition-colors">
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </div>
                        <span class="text-sm">3</span>
                      </button>
                      <button type="button" class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group">
                        <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                          </svg>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
