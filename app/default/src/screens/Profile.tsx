import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth, useFetch } from "@takos/app-sdk";
import { PostCard, type Post } from "../components/PostCard.js";
import { createCoreApi, type NormalizedUser } from "../lib/core-api.js";
import { toast, confirm } from "../lib/ui.js";

export function ProfileScreen() {
  const fetch = useFetch();
  const core = createCoreApi(fetch);
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { handle = "" } = useParams<{ handle: string }>();

  const [profile, setProfile] = useState<NormalizedUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = currentUser?.handle === handle;

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const userData = await core.getUser(handle);
      setProfile(userData);

      const userPosts = await core.listUserPosts(handle, 50);
      setPosts(userPosts);
    } catch (error) {
      console.error("Failed to load profile:", error);
      toast("Failed to load profile", "error");
    } finally {
      setLoading(false);
    }
  }, [core, handle]);

  useEffect(() => {
    if (handle) {
      loadProfile();
    }
  }, [handle, loadProfile]);

  const handleFollow = async () => {
    if (!profile) return;
    setFollowLoading(true);
    try {
      if (profile.isFollowing) {
        await core.unfollowUser(profile.id);
        setProfile(prev => prev ? { ...prev, isFollowing: false, followersCount: (prev.followersCount ?? 0) - 1 } : null);
      } else {
        await core.followUser(profile.id);
        setProfile(prev => prev ? { ...prev, isFollowing: true, followersCount: (prev.followersCount ?? 0) + 1 } : null);
      }
    } catch (error) {
      console.error("Failed to follow/unfollow:", error);
      toast("Failed to update follow status", "error");
    } finally {
      setFollowLoading(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
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

  if (!profile) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-bold">User not found</h1>
        <p className="mt-2 text-gray-500">@{handle}</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-4 text-blue-600 hover:underline"
        >
          Go home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Banner */}
      <div className="h-32 md:h-48 bg-gray-200 dark:bg-gray-800">
        {profile.banner && (
          <img
            src={profile.banner}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Profile Info */}
      <div className="px-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex justify-between items-start -mt-12 md:-mt-16">
          <div className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-white dark:border-black overflow-hidden bg-gray-200 dark:bg-gray-700">
            {profile.avatar ? (
              <img
                src={profile.avatar}
                alt={profile.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-gray-400">
                {profile.displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="mt-14 md:mt-18">
            {isOwnProfile ? (
              <Link
                to="/settings/profile"
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full font-semibold hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                Edit profile
              </Link>
            ) : currentUser ? (
              <button
                type="button"
                onClick={handleFollow}
                disabled={followLoading}
                className={`px-4 py-2 rounded-full font-semibold transition-colors disabled:opacity-50 ${
                  profile.isFollowing
                    ? "border border-gray-300 dark:border-gray-600 hover:border-red-300 hover:text-red-600"
                    : "bg-black dark:bg-white text-white dark:text-black hover:opacity-90"
                }`}
              >
                {profile.isFollowing ? "Following" : "Follow"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <h1 className="text-xl font-bold">{profile.displayName}</h1>
          <p className="text-gray-500 dark:text-gray-400">@{profile.handle}</p>
        </div>

        {profile.bio && (
          <p className="mt-3 whitespace-pre-wrap">{profile.bio}</p>
        )}

        <div className="mt-3 flex gap-4 text-sm">
          <Link to={`/@${profile.handle}/following`} className="hover:underline">
            <span className="font-semibold">{profile.followingCount}</span>
            <span className="text-gray-500 dark:text-gray-400 ml-1">Following</span>
          </Link>
          <Link to={`/@${profile.handle}/followers`} className="hover:underline">
            <span className="font-semibold">{profile.followersCount}</span>
            <span className="text-gray-500 dark:text-gray-400 ml-1">Followers</span>
          </Link>
        </div>

        {profile.createdAt ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
        ) : null}
      </div>

      {/* Posts */}
      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        {posts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No posts yet
          </div>
        ) : (
          posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUser?.id}
              onDelete={isOwnProfile ? handleDeletePost : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
