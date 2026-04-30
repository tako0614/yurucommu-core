import { assert, assertEquals } from "jsr:@std/assert";
import { storyToActivityPub } from "../../lib/activitypub-helpers.ts";
import type { Actor } from "../../types.ts";

Deno.test("storyToActivityPub emits a single attachment object", () => {
  const actor = {
    ap_id: "https://example.test/ap/users/alice",
  } as Actor;

  const object = storyToActivityPub(
    {
      apId: "https://example.test/ap/users/alice/stories/one",
      attributedTo: actor.ap_id,
      attachment: {
        type: "Document",
        mediaType: "image/jpeg",
        url: "/media/story.jpg",
        r2_key: "uploads/story.jpg",
      },
      displayDuration: "PT5S",
      endTime: "2026-05-01T00:00:00.000Z",
      published: "2026-04-30T00:00:00.000Z",
    },
    actor,
    "https://example.test",
  ) as { attachment: unknown };

  assert(!Array.isArray(object.attachment));
  assertEquals(object.attachment, {
    type: "Document",
    mediaType: "image/jpeg",
    url: "https://example.test/media/story.jpg",
  });
});
