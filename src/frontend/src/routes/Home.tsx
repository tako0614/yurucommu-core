import React, { useEffect, useState } from 'react';
import { PostCard } from '../components/post/PostCard';
import { Composer } from '../components/post/Composer';
import { useAuthStore } from '../stores/authStore';
import { api, type Post } from '../api/client';

export function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { user } = useAuthStore();

  const loadPosts = async () => {
    try {
      setLoading(true);
      const data = await api.getTimeline();
      setPosts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      await api.deletePost(id);
      setPosts(posts.filter((p) => p.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-gray-900">Home</h1>
      </header>

      <Composer onPost={loadPosts} />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 text-center text-red-600">{error}</div>
      ) : posts.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <p className="text-lg">No posts yet</p>
          <p className="text-sm mt-1">Be the first to share something!</p>
        </div>
      ) : (
        <div>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              username={user?.username ?? 'unknown'}
              displayName={user?.display_name ?? 'Unknown'}
              avatarUrl={user?.avatar_url}
              onDelete={handleDelete}
              isOwn
            />
          ))}
        </div>
      )}
    </div>
  );
}
