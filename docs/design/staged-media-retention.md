# Staged upload retention

Migration `0034_staged_media_retention.sql` introduces a seven-day attachment
window for **new, successfully settled uploads**. Core returns `expires_at` from
the upload endpoint; the API client exposes it optionally for older-server
compatibility. Consumers should disclose that deadline and preserve/reupload a
draft when a collected attachment is rejected. The DB fence yields
`409 MEDIA_EXPIRED`; a route that first requires extant upload metadata (such as
community icons) can instead fail its existing missing-upload preflight. This change does
not backfill upload lifetimes or infer deletion authority for legacy data.

## Atomic ownership

Before ObjectStore.put, Core still records an immutable `putting` attempt.
Unknown external writes never expire by age. After successful settlement, one
guarded database batch records upload metadata and its lifetime, then removes
the exact settled attempt. The lifetime retains the upload ID, key, uploader,
signing-key incarnation, and canonical UTC creation/expiry timestamps.

Every object attachment, actor icon/header, and community icon write updates a
database-owned reference index in the same SQL statement. The first reference
changes `staged` to permanent `published`. A scheduled collector claims up to
50 expired, never-published lifetimes in one UPDATE. Its atomic trigger creates
a durable blob deletion job and removes the exact upload metadata. Physical
deletion follows that commit and acknowledgment removes the job; provider
failure, missing storage or lost acknowledgment retains retry authority.

Reference-first serialization preserves the upload. Collection-first
serialization rejects the later source write with `MEDIA_EXPIRED`, even while
external deletion is in flight. A zero-row claim creates no job and performs no
deletion. The permanent `deleting` tombstone prevents physical-key or metadata
replay. Existing account-deletion reservations remain a separate authority.

## Conservative references and bounded migration

New uploads use a 64-character lowercase hexadecimal basename with one of the
six upload extensions. The index treats **any such filename** in decoded JSON
string values/object keys or image URLs as a reference. It includes nested and
embedded strings, raw keys, relative/absolute URLs, query/fragment text and
foreign origins. Filename-only matching deliberately favors over-retention;
it does not claim the media authorization route serves every alternate URL
form. Four finite percent-decoding passes cover the ASCII filename alphabet,
including encoded dot and percent; URL-ignored tab/newline/carriage returns are
removed. Non-ASCII percent escapes and literal invalid percent text are not
guessed into ASCII filenames.

The DB envelope permits at most 16K Unicode characters and 48 KiB of UTF-8
bytes. This size envelope preserves the existing 16K UTF-16-code-unit
attachment limit, including Japanese/emoji text. JSON trees contain at most
256 nodes; each normalized scalar contains at most 256 dots to bound recursive
filename search. Malformed JSON, embedded NUL, oversized, structurally too wide
or still-ambiguous decoding refuses a new reference write with
`400 MEDIA_REFERENCE_INVALID`. Legacy ambiguity is preserved in a global
indexed blocker, rather than discarded or classified. Such a row suspends
staged collection until its owner resolves it; an ordinary inbound reference
can also permanently publish a known upload ID. Neither is a guarantee of
complete orphan reclamation.

The migration installs source-write triggers immediately and initializes three
durable backfill cursors without scanning existing payloads. A retention pass
processes up to ten current rows per source family. Reading the current page,
advancing its cursor and proving completion share one atomic batch. Inserts
behind the cursor and intervening updates/deletes are covered by the active
source triggers. Collection remains closed in both its query and SQL trigger
until all three cursors finish. The initial NULL cursor includes empty legacy
IDs; any legacy NULL source ID separately blocks collection via indexed probes
until its owner repairs/removes it. The journal and transient normalization inputs
are trusted engine-internal authority, not operator override endpoints.

## Adoption and limits

Apply the migration before serving this engine, with the owning product's
writers closed for activation. Do not enable old writers that bypass its new
lifetime contract. Confirm all cursors complete and inspect preserved ambiguity
rows before treating the collector as operational. An operator may need to
repair legacy source data under separate authorization; this feature does not
delete it or provide an automatic override. Rolling back to an older engine
cannot safely revive collected keys, so use forward repair and retained
provider/database backup evidence rather than deleting tombstones.

This protocol covers newly settled uploads that were **never published**. Once
published, migration0035's [published deletion protocol](published-media-deletion.md)
coordinates object/profile/Story/account cleanup through permanent key claims.
Unsupported legacy-key adjudication, actual provider behavior, real existing-data
update/restore, Core/API publication and consumer adoption remain separate
dependencies. Generic Core and Yurumeet registration
semantics are unchanged; Yurucommu's single-owner premise remains product-owned.

Portable tests establish local behavior. Isolated D1/workerd qualification must
also establish trigger/batch behavior, bounded query shapes and worst-case
source processing cost; it does not establish live D1, R2, Cron or public-host
readiness.
