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
    <div>
      <header className="view-header">
        <div className="view-header-content">
          <h2>Home</h2>
        </div>
      </header>

      <Composer onPost={loadPosts} />

      {loading ? (
        <div className="loading-screen" style={{ minHeight: '200px' }}>
          <div className="loading-spinner" />
        </div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <h3>No posts yet</h3>
          <p>Be the first to share something!</p>
        </div>
      ) : (
        <div className="timeline">
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
