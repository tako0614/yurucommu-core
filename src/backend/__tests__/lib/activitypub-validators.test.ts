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

Deno.test("parseRemoteActor parses Mastodon actor", () => {
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
  assertEquals(actor.id, "https://mastodon.example/users/alice");
  assertEquals(actor.preferredUsername, "alice");
  assertEquals(actor.inbox, "https://mastodon.example/users/alice/inbox");
  assertEquals(actor.endpoints?.sharedInbox, "https://mastodon.example/inbox");
  assertEquals(
    actor.publicKey?.publicKeyPem,
    "-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----",
  );
  assertEquals(actor.icon?.url, "https://mastodon.example/avatars/alice.png");
});

Deno.test("parseRemoteActor parses Misskey actor (icon optional fields)", () => {
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
  assertEquals(actor.id, "https://misskey.example/users/9abc");
  assertEquals(actor.icon, undefined);
});

Deno.test("parseRemoteActor accepts unknown extension fields", () => {
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
  assertEquals(actor.id, "https://pleroma.example/users/dave");
  assertEquals(actor.preferredUsername, "dave");
});

Deno.test("parseRemoteActor throws on missing id", () => {
  const err = assertThrows(
    () => parseRemoteActor({ type: "Person", preferredUsername: "alice" }),
    ActivityPubContractError,
  );
  assertEquals(err.path, "$.id");
});

Deno.test("parseRemoteActor throws on non-string id", () => {
  const err = assertThrows(
    () => parseRemoteActor({ id: 42, type: "Person" }),
    ActivityPubContractError,
  );
  assertEquals(err.path, "$.id");
});

Deno.test("parseRemoteActor throws on non-object input", () => {
  for (const value of [null, undefined, "string", 42, [], true]) {
    const err = assertThrows(
      () => parseRemoteActor(value),
      ActivityPubContractError,
    );
    assertInstanceOf(err, ActivityPubContractError);
  }
});

Deno.test("parseRemoteActor drops malformed optional fields silently", () => {
  const actor = parseRemoteActor({
    id: "https://example/users/x",
    preferredUsername: 42, // wrong type
    inbox: ["array", "not", "string"], // wrong type
    publicKey: { id: "key", publicKeyPem: 123 }, // pem wrong type
  });
  assertEquals(actor.id, "https://example/users/x");
  assertEquals(actor.preferredUsername, undefined);
  assertEquals(actor.inbox, undefined);
  assertEquals(actor.publicKey?.publicKeyPem, undefined);
});

Deno.test("tryParseRemoteActor returns null instead of throwing", () => {
  assertStrictEquals(tryParseRemoteActor({ type: "Person" }), null);
  assertStrictEquals(tryParseRemoteActor("not an object"), null);
});

// ---------------------------------------------------------------------------
// parseActivity — real-world fixtures
// ---------------------------------------------------------------------------

Deno.test("parseActivity parses Mastodon Follow activity (object as IRI)", () => {
  const follow = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://mastodon.example/users/alice#follows/123",
    type: "Follow",
    actor: "https://mastodon.example/users/alice",
    object: "https://yurucommu.example/users/bob",
  };
  const activity = parseActivity(follow);
  assertEquals(activity.type, "Follow");
  assertEquals(activity.actor, "https://mastodon.example/users/alice");
  assertEquals(activity.object, "https://yurucommu.example/users/bob");
});

Deno.test("parseActivity parses Pleroma Create(Note) activity (nested object)", () => {
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
  assertEquals(activity.type, "Create");
  const obj = activity.object;
  if (typeof obj === "string" || !obj) {
    throw new Error("expected nested object");
  }
  assertEquals(obj.type, "Note");
  assertEquals(obj.content, "<p>hello fediverse</p>");
  assertEquals(obj.inReplyTo, "https://yurucommu.example/objects/parent");
  assertEquals(obj.to, ["https://www.w3.org/ns/activitystreams#Public"]);
  // attachment is passed through opaquely
  if (!Array.isArray(obj.attachment)) {
    throw new Error("expected attachment array");
  }
});

Deno.test("parseActivity parses Undo(Follow)", () => {
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
  assertEquals(activity.type, "Undo");
  const inner = activity.object;
  if (typeof inner === "string" || !inner) {
    throw new Error("expected nested undo object");
  }
  assertEquals(inner.type, "Follow");
  assertEquals(inner.object, "https://yurucommu.example/users/bob");
});

Deno.test("parseActivity drops null/wrong-typed summary on nested object gracefully", () => {
  const create = {
    type: "Create",
    actor: "https://example/u/a",
    object: { type: "Note", summary: null, content: "text" },
  };
  const activity = parseActivity(create);
  const obj = activity.object;
  if (typeof obj === "string" || !obj) throw new Error("nested object missing");
  assertStrictEquals(obj.summary, null);
  assertEquals(obj.content, "text");
});

Deno.test("parseActivity drops nested object when neither IRI nor record", () => {
  const malformed = {
    type: "Create",
    actor: "https://example/u/a",
    object: 42,
  };
  const activity = parseActivity(malformed);
  assertStrictEquals(activity.object, undefined);
});

Deno.test("parseActivity throws on non-object body", () => {
  assertThrows(() => parseActivity(null), ActivityPubContractError);
  assertThrows(() => parseActivity("string"), ActivityPubContractError);
  assertThrows(() => parseActivity([]), ActivityPubContractError);
});

// ---------------------------------------------------------------------------
// parseWebFinger
// ---------------------------------------------------------------------------

Deno.test("parseWebFinger extracts self link", () => {
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
  assertEquals(wf.links?.length, 2);
  const selfLink = wf.links?.find((l) =>
    l.rel === "self" && l.type === "application/activity+json"
  );
  assertEquals(selfLink?.href, "https://mastodon.example/users/alice");
});

Deno.test("parseWebFinger returns empty when links is missing or wrong type", () => {
  assertEquals(parseWebFinger({ subject: "acct:x@y" }).links, undefined);
  assertEquals(parseWebFinger({ links: "not an array" }).links, undefined);
});

Deno.test("parseWebFinger skips non-object link entries", () => {
  const wf = parseWebFinger({
    links: [
      "not an object",
      null,
      { rel: "self", href: "https://example" },
    ],
  });
  assertEquals(wf.links?.length, 1);
  assertEquals(wf.links?.[0].href, "https://example");
});

Deno.test("parseWebFinger throws on non-object body", () => {
  assertThrows(() => parseWebFinger(null), ActivityPubContractError);
});
