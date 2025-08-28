import type { DataStore } from "../db/types.ts";
import {
  buildActivityFromStored,
  createCreateActivity,
  deliverActivityPubObject,
  isLocalActor,
} from "../utils/activitypub.ts";
import { deliverToFollowers } from "../utils/deliver.ts";
import { addNotification } from "./notification.ts";
import { announceIfPublicAndDiscoverable } from "./fasp.ts";
import { broadcast, sendToUser } from "../routes/ws.ts";

type ActivityObject = Record<string, unknown>;

async function findPost(
  db: DataStore,
  id: string,
): Promise<ActivityObject | null> {
  const note = await db.posts.findNoteById(id) as ActivityObject | null;
  if (note) return note;
  return await db.posts.findMessageById(id) as ActivityObject | null;
}

export async function createPost(
  db: DataStore,
  domain: string,
  author: string,
  content: string,
  extra: Record<string, unknown>,
  parentId?: string,
): Promise<{
  post: ActivityObject;
  createActivity: ActivityObject;
  objectId: string;
}> {
  const post = await db.posts.saveNote(
    domain,
    author,
    content,
    extra,
  ) as ActivityObject;
  if (typeof parentId === "string") {
    await db.posts.updateNote(parentId, { $inc: { "extra.replies": 1 } }).catch(
      () => {},
    );
  }
  const baseObj = post as Record<string, unknown>;
  const noteObject = buildActivityFromStored(
    {
      ...baseObj,
      content: typeof post.content === "string" ? post.content : "",
      _id: String(baseObj._id),
      type: typeof baseObj.type === "string" ? baseObj.type : "Note",
      published: typeof baseObj.published === "string"
        ? baseObj.published
        : new Date().toISOString(),
      extra: (typeof baseObj.extra === "object" && baseObj.extra !== null &&
          !Array.isArray(baseObj.extra))
        ? baseObj.extra as Record<string, unknown>
        : {},
    },
    domain,
    author,
    false,
  );
  const createActivity = createCreateActivity(
    domain,
    `https://${domain}/users/${author}`,
    noteObject,
  );
  const objectId = String(baseObj._id ?? "");
  return { post, createActivity, objectId };
}

export async function notifyFollowers(
  env: Record<string, string>,
  author: string,
  createActivity: ActivityObject,
  domain: string,
  db: DataStore,
  post: ActivityObject,
  parentId?: string,
  objectId?: string,
): Promise<void> {
  deliverToFollowers(env, author, createActivity, domain);
  if (parentId) {
    const parent = await findPost(db, parentId);
    if (
      parent &&
      typeof (parent as ActivityObject).actor_id === "string" &&
      !isLocalActor((parent as ActivityObject).actor_id as string, domain)
    ) {
      deliverActivityPubObject(
        [(parent as ActivityObject).actor_id as string],
        createActivity,
        author,
        domain,
        env,
      );
    } else if (
      parent &&
      typeof (parent as ActivityObject).actor_id === "string"
    ) {
      try {
        const url = new URL((parent as ActivityObject).actor_id as string);
        const localName = url.pathname.split("/")[2];
        if (
          localName && localName !== author && isLocalActor(url.href, domain)
        ) {
          await addNotification(
            "新しい返信",
            `${author}さんが${localName}さんの投稿に返信しました`,
            "info",
            env,
          );
        }
      } catch {
        /* ignore */
      }
    }
  }
  const objId = objectId || String((post as Record<string, unknown>)._id ?? "");
  broadcast({
    type: "hasUpdate",
    payload: { kind: "newPost", id: objId },
  });
  const account = await db.accounts.findByUserName(author);
  const followers = account?.followers ?? [];
  const localFollowers = followers
    .map((url) => {
      try {
        const u = new URL(url);
        if (u.hostname !== domain || !u.pathname.startsWith("/users/")) {
          return null;
        }
        return `${u.pathname.split("/")[2]}@${domain}`;
      } catch {
        return null;
      }
    })
    .filter((v): v is string => !!v);
  localFollowers.push(`${author}@${domain}`);
  for (const f of localFollowers) {
    sendToUser(f, {
      type: "hasUpdate",
      payload: { kind: "newPost", id: objId },
    });
  }
}

export async function announceToFasp(
  env: Record<string, string>,
  domain: string,
  post: ActivityObject,
  objectId: string,
  faspShare?: boolean,
): Promise<void> {
  if (objectId && faspShare !== false) {
    const objectUrl = `https://${domain}/objects/${objectId}`;
    await announceIfPublicAndDiscoverable(env, domain, {
      category: "content",
      eventType: "new",
      objectUris: [objectUrl],
    }, post);
  }
}
