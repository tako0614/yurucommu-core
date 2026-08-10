# Sent Stamps own immutable snapshots

A Message stores a `MessageStampSnapshot` of the exact `StampRevision` it sent,
including the asset digest and fallback text, instead of resolving display from
a mutable `Stamp.id`. This duplicates a small amount of pack metadata, but it
prevents publisher edits, pack removal, entitlement loss, or a remote server
disappearing from rewriting message history; logical Stamp identity remains
separate so favorites and recent use can still follow later revisions.
