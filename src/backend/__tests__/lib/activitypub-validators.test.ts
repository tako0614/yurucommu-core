import { expect, test } from "bun:test";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert";
import {
  ActivityPubContractError,
  parseActivity,
  parseRemoteActor,
  parseWebFinger,
  tryParseRemoteActor,
} from "../../lib/activitypub-validators.ts";

// ---------------------------------------------------------------------------
// parseRemoteActor — real-world fixtures
// ---------------------------------------------------------------------------

test("parseRemoteActor parses Mastodon actor", () => {
  const mastodon = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: "https://mastodon.example/users/alice",
    type: "Person",
    preferredUsername: "alice",
    name: "Alice",
    summary: "<p>hello</p>",
    inbox: "https://mastodon.example/users/alice/inbox",
    outbox: "https://mastodon.example/users/alice/outbox",
    followers: "https://mastodon.example/users/alice/followers",
    following: "https://mastodon.example/users/alice/following",
    icon: {
      type: "Image",
      mediaType: "image/png",
      url: "https://mastodon.example/avatars/alice.png",
    },
    endpoints: {
      sharedInbox: "https://mastodon.example/inbox",
    },
    publicKey: {
      id: "https://mastodon.example/users/alice#main-key",
      owner: "https://mastodon.example/users/alice",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----",
    },
  };
  const actor = parseRemoteActor(mastodon);
  expect(actor.id).toEqual("https://mastodon.example/users/alice");
  expect(actor.preferredUsername).toEqual("alice");
  expect(actor.inbox).toEqual("https://mastodon.example/users/alice/inbox");
  expect(actor.endpoints?.sharedInbox).toEqual("https://mastodon.example/inbox");
  expect(actor.publicKey?.publicKeyPem).toEqual("-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----");
  expect(actor.icon?.url).toEqual("https://mastodon.example/avatars/alice.png");
});

test("parseRemoteActor parses Misskey actor (icon optional fields)", () => {
  const misskey = {
    id: "https://misskey.example/users/9abc",
    type: "Person",
    preferredUsername: "carol",
    name: "carol",
    inbox: "https://misskey.example/users/9abc/inbox",
    publicKey: {
      id: "https://misskey.example/users/9abc#main-key",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nABC...\n-----END PUBLIC KEY-----",
    },
    // Misskey can omit icon entirely or send a bare object
  };
  const actor = parseRemoteActor(misskey);
  expect(actor.id).toEqual("https://misskey.example/users/9abc");
  expect(actor.icon).toEqual(undefined);
});

test("parseRemoteActor accepts unknown extension fields", () => {
  const extended = {
    id: "https://pleroma.example/users/dave",
    type: "Person",
    preferredUsername: "dave",
    inbox: "https://pleroma.example/users/dave/inbox",
    // Lemmy / Pleroma extensions:
    discoverable: true,
    "vcard:bday": "1990-01-01",
    customField: { nested: "value" },
  };
  const actor = parseRemoteActor(extended);
  expect(actor.id).toEqual("https://pleroma.example/users/dave");
  expect(actor.preferredUsername).toEqual("dave");
});

test("parseRemoteActor throws on missing id", () => {
  const err = assertThrows(
    () => parseRemoteActor({ type: "Person", preferredUsername: "alice" }),
    ActivityPubContractError,
  );
  expect(err.path).toEqual("$.id");
});

test("parseRemoteActor throws on non-string id", () => {
  const err = assertThrows(
    () => parseRemoteActor({ id: 42, type: "Person" }),
    ActivityPubContractError,
  );
  expect(err.path).toEqual("$.id");
});

test("parseRemoteActor throws on non-object input", () => {
  for (const value of [null, undefined, "string", 42, [], true]) {
    const err = assertThrows(
      () => parseRemoteActor(value),
      ActivityPubContractError,
    );
    expect(err).toBeInstanceOf(ActivityPubContractError);
  }
});

test("parseRemoteActor drops malformed optional fields silently", () => {
  const actor = parseRemoteActor({
    id: "https://example/users/x",
    preferredUsername: 42, // wrong type
    inbox: ["array", "not", "string"], // wrong type
    publicKey: { id: "key", publicKeyPem: 123 }, // pem wrong type
  });
  expect(actor.id).toEqual("https://example/users/x");
  expect(actor.preferredUsername).toEqual(undefined);
  expect(actor.inbox).toEqual(undefined);
  expect(actor.publicKey?.publicKeyPem).toEqual(undefined);
});

test("tryParseRemoteActor returns null instead of throwing", () => {
  expect(tryParseRemoteActor({ type: "Person" })).toBe(null);
  expect(tryParseRemoteActor("not an object")).toBe(null);
});

// ---------------------------------------------------------------------------
// parseActivity — real-world fixtures
// ---------------------------------------------------------------------------

test("parseActivity parses Mastodon Follow activity (object as IRI)", () => {
  const follow = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://mastodon.example/users/alice#follows/123",
    type: "Follow",
    actor: "https://mastodon.example/users/alice",
    object: "https://yurucommu.example/users/bob",
  };
  const activity = parseActivity(follow);
  expect(activity.type).toEqual("Follow");
  expect(activity.actor).toEqual("https://mastodon.example/users/alice");
  expect(activity.object).toEqual("https://yurucommu.example/users/bob");
});

test("parseActivity parses Pleroma Create(Note) activity (nested object)", () => {
  const create = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://pleroma.example/activities/abc",
    type: "Create",
    actor: "https://pleroma.example/users/eve",
    object: {
      id: "https://pleroma.example/objects/xyz",
      type: "Note",
      content: "<p>hello fediverse</p>",
      inReplyTo: "https://yurucommu.example/objects/parent",
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      published: "2026-05-14T00:00:00Z",
      attachment: [{ type: "Document", url: "https://example/file.png" }],
    },
  };
  const activity = parseActivity(create);
  expect(activity.type).toEqual("Create");
  const obj = activity.object;
  if (typeof obj === "string" || !obj) {
    throw new Error("expected nested object");
  }
  expect(obj.type).toEqual("Note");
  expect(obj.content).toEqual("<p>hello fediverse</p>");
  expect(obj.inReplyTo).toEqual("https://yurucommu.example/objects/parent");
  expect(obj.to).toEqual(["https://www.w3.org/ns/activitystreams#Public"]);
  // attachment is passed through opaquely
  if (!Array.isArray(obj.attachment)) {
    throw new Error("expected attachment array");
  }
});

test("parseActivity parses Undo(Follow)", () => {
  const undo = {
    id: "https://mastodon.example/users/alice#undo/123",
    type: "Undo",
    actor: "https://mastodon.example/users/alice",
    object: {
      id: "https://mastodon.example/users/alice#follows/123",
      type: "Follow",
      actor: "https://mastodon.example/users/alice",
      object: "https://yurucommu.example/users/bob",
    },
  };
  const activity = parseActivity(undo);
  expect(activity.type).toEqual("Undo");
  const inner = activity.object;
  if (typeof inner === "string" || !inner) {
    throw new Error("expected nested undo object");
  }
  expect(inner.type).toEqual("Follow");
  expect(inner.object).toEqual("https://yurucommu.example/users/bob");
});

test("parseActivity drops null/wrong-typed summary on nested object gracefully", () => {
  const create = {
    type: "Create",
    actor: "https://example/u/a",
    object: { type: "Note", summary: null, content: "text" },
  };
  const activity = parseActivity(create);
  const obj = activity.object;
  if (typeof obj === "string" || !obj) throw new Error("nested object missing");
  expect(obj.summary).toBe(null);
  expect(obj.content).toEqual("text");
});

test("parseActivity drops nested object when neither IRI nor record", () => {
  const malformed = {
    type: "Create",
    actor: "https://example/u/a",
    object: 42,
  };
  const activity = parseActivity(malformed);
  expect(activity.object).toBe(undefined);
});

test("parseActivity throws on non-object body", () => {
  assertThrows(() => parseActivity(null), ActivityPubContractError);
  assertThrows(() => parseActivity("string"), ActivityPubContractError);
  assertThrows(() => parseActivity([]), ActivityPubContractError);
});

// ---------------------------------------------------------------------------
// parseWebFinger
// ---------------------------------------------------------------------------

test("parseWebFinger extracts self link", () => {
  const jrd = {
    subject: "acct:alice@mastodon.example",
    links: [
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: "https://mastodon.example/@alice",
      },
      {
        rel: "self",
        type: "application/activity+json",
        href: "https://mastodon.example/users/alice",
      },
    ],
  };
  const wf = parseWebFinger(jrd);
  expect(wf.links?.length).toEqual(2);
  const selfLink = wf.links?.find((l) =>
    l.rel === "self" && l.type === "application/activity+json"
  );
  expect(selfLink?.href).toEqual("https://mastodon.example/users/alice");
});

test("parseWebFinger returns empty when links is missing or wrong type", () => {
  expect(parseWebFinger({ subject: "acct:x@y" }).links).toEqual(undefined);
  expect(parseWebFinger({ links: "not an array" }).links).toEqual(undefined);
});

test("parseWebFinger skips non-object link entries", () => {
  const wf = parseWebFinger({
    links: [
      "not an object",
      null,
      { rel: "self", href: "https://example" },
    ],
  });
  expect(wf.links?.length).toEqual(1);
  expect(wf.links?.[0].href).toEqual("https://example");
});

test("parseWebFinger throws on non-object body", () => {
  assertThrows(() => parseWebFinger(null), ActivityPubContractError);
});
