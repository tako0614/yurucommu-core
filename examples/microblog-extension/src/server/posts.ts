import { ServerExtension } from "@takopack/builder/src/classes.ts";
import { getTakosServerAPI } from "@takopack/builder/src/api-helpers.ts";

interface Post {
  id: number;
  text: string;
  timestamp: number;
}

const MicroblogServer = new ServerExtension();

/** @event("addPost", { source: "client" }) */
MicroblogServer.onAddPost = async (
  payload: { text: string },
): Promise<[number, Record<string, unknown>]> => {
  const takos = getTakosServerAPI();
  const rawPosts = await takos?.kv.read("posts");
  const posts: Post[] = Array.isArray(rawPosts) ? rawPosts : [];
  const post: Post = { id: Date.now(), text: payload.text.slice(0, 280), timestamp: Date.now() };
  posts.push(post);
  await takos?.kv.write("posts", posts);
  await takos?.events.publish("timelineUpdated", { posts });
  return [200, { ok: true }];
};

/** @event("getTimeline", { source: "client" }) */
MicroblogServer.onGetTimeline = async (): Promise<[number, Record<string, unknown>]
> => {
  const takos = getTakosServerAPI();
  const rawPosts = await takos?.kv.read("posts");
  const posts: Post[] = Array.isArray(rawPosts) ? rawPosts : [];
  return [200, { posts }];
};

export { MicroblogServer };
