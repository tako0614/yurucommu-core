import { deriveStoryVisibility, toStoryObject } from "./activitypub-story";
import { getActorUri, requireInstanceDomain } from "../subdomain";
import { makeData } from "../server/data-factory";
import { enqueueActivity } from "./outbox";

export async function publishStoryCreate(env: any, story: any) {
  const store = makeData(env);
  try {
    const author = await store.getUser(story.author_id);
    if (!author) return;
    const instanceDomain = requireInstanceDomain(env);
    const visibility = deriveStoryVisibility(story);
    const storyObject = toStoryObject(story, author.id, instanceDomain);
    const actorUri = getActorUri(author.id, instanceDomain);
    const followersUrl = `https://${instanceDomain}/ap/users/${author.id}/followers`;
    await enqueueActivity(env, {
      type: "Create",
      actor: actorUri,
      object: storyObject,
      to: visibility === "public"
        ? ["https://www.w3.org/ns/activitystreams#Public"]
        : [followersUrl],
    });
  } finally {
    await store.disconnect?.();
  }
}

export async function publishStoryDelete(env: any, story: any) {
  const instanceDomain = requireInstanceDomain(env);
  const storyId = `https://${instanceDomain}/ap/stories/${story.id}`;
  const actorUri = getActorUri(story.author_id, instanceDomain);
  await enqueueActivity(env, {
    type: "Delete",
    actor: actorUri,
    object: storyId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  });
}
