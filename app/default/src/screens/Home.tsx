import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth, useFetch } from "@takos/app-sdk";
import { PostCard, type Post } from "../components/PostCard.js";
import { createCoreApi } from "../lib/core-api.js";
import { toast, confirm } from "../lib/ui.js";

export function HomeScreen() {
  const fetch = useFetch();
  const core = createCoreApi(fetch);
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTimeline = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await core.listTimeline(50);
      setPosts(data);
    } catch (error) {
      console.error("Failed to load timeline:", error);
      toast("Failed to load timeline", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [core]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadTimeline(false);
  };

  const handleDelete = async (postId: string) => {
    const ok = await confirm("Delete this post?");
    if (!ok) return;

    try {
      await core.deletePost(postId);
      setPosts(prev => prev.filter(p => p.id !== postId));
      toast("Post deleted", "success");
    } catch (error) {
      console.error("Failed to delete post:", error);
      toast("Failed to delete post", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between z-10">
        <h1 className="text-xl font-bold">Home</h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-900 rounded-full transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshIcon className={refreshing ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        {posts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No posts yet.</p>
            <p className="mt-2">
              <Link to="/compose" className="text-blue-600 hover:underline">
                Create your first post
              </Link>
            </p>
          </div>
        ) : (
          posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user?.id}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RefreshIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`w-5 h-5 ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}
