import { expect, test } from "bun:test";

import {
  storyToActivityPub,
  toApAttachments,
} from "../../lib/activitypub-helpers.ts";
import type { Actor } from "../../types.ts";

test("storyToActivityPub emits a single attachment object", () => {
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

  expect(!Array.isArray(object.attachment)).toBeTruthy();
  expect(object.attachment).toEqual({
    type: "Document",
    mediaType: "image/jpeg",
    url: "https://example.test/media/story.jpg",
  });
});

test("storyToActivityPub federates the caption as Note content", () => {
  const actor = {
    ap_id: "https://example.test/ap/users/alice",
  } as Actor;

  const withCaption = storyToActivityPub(
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
      caption: "hello world",
      endTime: "2026-05-01T00:00:00.000Z",
      published: "2026-04-30T00:00:00.000Z",
    },
    actor,
    "https://example.test",
  ) as { content?: string };

  expect(withCaption.content).toBe("hello world");

  // No caption -> no `content` key at all (rather than an empty string).
  const withoutCaption = storyToActivityPub(
    {
      apId: "https://example.test/ap/users/alice/stories/two",
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
  ) as Record<string, unknown>;

  expect("content" in withoutCaption).toBe(false);
});

test("toApAttachments emits a standard Image plus the bounded Stamp extension", () => {
  const stampId = "https://alice.example/stamp-packs/cat/stamps/okay";
  const packId = "https://alice.example/stamp-packs/cat";
  const sha256 = "a".repeat(64);

  expect(
    toApAttachments(
      [
        {
          type: "Image",
          url: `/media/stamps/${sha256}.webp`,
          r2_key: `stamps/sha256/aa/${sha256}.webp`,
          content_type: "image/webp",
          name: "了解！",
          stamp: stampId,
          stamp_pack: packId,
          stamp_revision: `sha256:${"b".repeat(64)}`,
          stamp_sha256: sha256,
          width: 512,
          height: 512,
        },
      ],
      "https://yuru.test",
    ),
  ).toEqual([
    {
      type: "Image",
      mediaType: "image/webp",
      url: `https://yuru.test/media/stamps/${sha256}.webp`,
      name: "了解！",
      width: 512,
      height: 512,
      "yurucommu:stamp": stampId,
      "yurucommu:pack": packId,
      "yurucommu:revision": `sha256:${"b".repeat(64)}`,
      "yurucommu:sha256": sha256,
    },
  ]);
});

test("toApAttachments degrades an invalid Stamp extension to an ordinary Document", () => {
  expect(
    toApAttachments(
      [
        {
          url: "/media/stamps/image.webp",
          content_type: "image/webp",
          name: "fallback",
          stamp: "not-a-url",
          stamp_pack: "https://alice.example/stamp-packs/cat",
          stamp_revision: "mutable",
          stamp_sha256: "bad",
          width: 512,
          height: 512,
        },
      ],
      "https://yuru.test",
    ),
  ).toEqual([
    {
      type: "Document",
      mediaType: "image/webp",
      url: "https://yuru.test/media/stamps/image.webp",
      name: "fallback",
    },
  ]);
});
