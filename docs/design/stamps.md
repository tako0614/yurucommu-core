# Stamp packs and immutable message snapshots

## Ownership

`yurucommu-core` owns the reusable Stamp data model, authenticated API,
ActivityPub projection, media integrity, and Actor-scoped send authority.
Deployable products own their picker and rendering UX. Takosumi may later issue
an external commercial grant through an entitlement adapter, but it does not
own packs, messages, federation, or self-hosted free entitlements.

The persisted principal is an ActivityPub Actor ID. An OIDC account or billing
customer can authorize a grant, but Core projects that grant to a local Actor's
`StampEntitlement`; login-provider subjects are not messaging identities.

## Invariants

1. A published `StampPackRelease` and `StampRevision` never mutate.
2. Replacing an image creates a new revision; changing pack contents creates a
   new release.
3. A sent Message owns a complete `MessageStampSnapshot`. Display never needs
   to dereference the current `Stamp` row.
4. A client selects a logical Stamp. Core resolves the Actor's installed
   release and entitlement, then creates trusted snapshot fields from its own
   rows. Client-supplied URLs, dimensions, media types, and hashes are not send
   authority.
5. Uninstall removes picker placement only. Revocation blocks future sends but
   never hides an already received Message.
6. Stamp images are immutable PNG or static WebP assets, at most 512 by 512,
   addressed by lowercase SHA-256. SVG, scripts, external subresources, audio,
   and animation are outside v1.
7. Price is not content. A future `StampOffer` belongs to each sales channel;
   no price or DRM field participates in a pack manifest or revision identity.
8. Stamp messages and reactions remain separate models. A Stamp message is an
   ordered Message; a reaction is an edge attached to another Message.

## Persisted shape

Migration `0030` adds only new tables:

- `stamp_packs`
- `stamp_pack_releases`
- `stamps`
- `stamp_revisions`
- `stamp_release_items`
- `stamp_entitlements`
- `stamp_installations`
- `stamp_favorites`
- `stamp_recents`
- `message_stamp_refs`
- `stamp_asset_mirrors`

`stamp_release_items` is the immutable ordered membership of a release. It
avoids reconstructing an old release from each logical Stamp's mutable
`current_revision_id` or `sort_order`.

`message_stamp_refs.message_id` names an existing ActivityPub `Note` object but
the table does not introduce a new foreign-key policy into the established
cross-runtime object schema. Existing object/account teardown code owns the
corresponding explicit cleanup.

## Local publication and installation

The first slice publishes free local packs from media already uploaded by the
authenticated Actor. Core verifies upload ownership, PNG/WebP bytes, actual
dimensions, and the 512 by 512 limit, strips metadata through the existing
image boundary, hashes the resulting bytes, and writes the immutable asset at:

```text
stamps/sha256/<first-two-hex>/<digest>.<png|webp>
```

Publishing writes one pack, release, logical Stamp set, revision set, and
ordered release membership as one D1-safe transition. Reusing identical bytes
reuses the content-addressed object. A DB failure after a new object write is
repaired forward or deletes only a blob proven unreferenced; it never
overwrites bytes at an existing digest.

A public free pack can issue a local Actor the `install` and `send` rights when
they install it. Installation records one immutable release and picker order.
Uninstall deletes only that Actor's installation row.

## Message API contract

DM and community-message create bodies gain one optional selection:

```ts
type StampSelection = {
  stamp_id: string;
};
```

Exactly one of non-empty text, ordinary attachments, or `stamp` is required.
When `stamp` is present, ordinary attachments and custom text are rejected in
v1 so one Message has one unambiguous rendering mode. The server resolves the
Actor's installed release and send entitlement, snapshots the release's exact
revision, and stores fallback content in the form `[Stamp: <alt>]`.

Read responses gain:

```ts
type MessageStampSnapshot = {
  id: string;
  pack_id: string;
  revision: `sha256:${string}`;
  asset: {
    url: string;
    media_type: "image/webp" | "image/png";
    width: number;
    height: number;
    sha256: string;
  };
  alt: string;
};
```

The ordinary `attachments` projection also includes the image, so older
clients remain able to render it. New clients prefer `stamp` and suppress the
fallback text/duplicate attachment presentation.

## ActivityPub contract

Outbound federation remains standard `Create(Note)`. The Note contains bounded
fallback text and one standard `Image` attachment. Inline JSON-LD terms use the
public `https://yurucommu.com/ns/stamp#` namespace and are kept byte-for-term in
sync with the product-hosted context document.

```json
{
  "type": "Note",
  "content": "[Stamp: OK]",
  "attachment": [
    {
      "type": "Image",
      "name": "OK",
      "mediaType": "image/webp",
      "url": "https://alice.example/media/stamps/9518f6.webp",
      "stamp": "https://alice.example/stamp-packs/cat/stamps/okay",
      "stampPack": "https://alice.example/stamp-packs/cat",
      "stampRevision": "sha256:9518f6...",
      "stampSha256": "9518f6...",
      "width": 512,
      "height": 512
    }
  ]
}
```

An unaware peer displays an image post. Aware peers validate the optional
extension and persist a `MessageStampSnapshot`. An invalid extension degrades
to the ordinary bounded attachment; it does not reject or upgrade the Note.

Inbound storage happens only after the normal HTTP-Signature actor binding,
addressing/read gates, block/mute policy, object identity checks, and size
limits. A remote URL is never local display authority. Mirroring uses the
existing redirect-denying, DNS-resolving SSRF gate, verifies content type,
magic bytes, actual dimensions, body size, and SHA-256, then writes the exact
digest key. Until mirroring succeeds, the client has bounded fallback text and
may use the original remote image according to the same message visibility
gate; a different digest is never substituted.

## Later manifest distribution

Pack manifests and downloadable archives are a later slice. Their identity
contains content and hashes only. Store-specific price, region, promotion, and
revenue-sharing data belongs to a separate offer provider. Remote Manifest
installation must use conditional HTTP (`ETag`/`If-None-Match`), bounded bodies,
SSRF protection, hash verification, and a new immutable local release rather
than mutating previously installed content.
