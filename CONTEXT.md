# Yurucommu Family Engine

The shared social, messaging, and federation language used by Yurucommu-family
servers and clients.

## Stamps

**StampPack**:
A publisher-owned collection that people discover, receive rights to, and add
to their Stamp picker.
_Avoid_: Sticker bundle, Store item

**StampPackRelease**:
An immutable publication of one StampPack's exact ordered StampRevision set.
_Avoid_: Pack version, mutable manifest

**Stamp**:
The stable logical identity of one expression inside a StampPack; favorites and
recent use follow this identity across revisions.
_Avoid_: Stamp image, MessageStampSnapshot

**StampRevision**:
An immutable visual and fallback representation of one Stamp.
_Avoid_: Current Stamp, editable asset

**StampEntitlement**:
An Actor-scoped grant of install and/or send rights for one StampPack.
_Avoid_: Purchase, installation

**StampInstallation**:
An Actor's choice to expose one entitled StampPack in their picker at one
installed release.
_Avoid_: Ownership, entitlement

**MessageStampSnapshot**:
The immutable StampRevision identity, asset digest, dimensions, media type,
and fallback text owned by a sent Message.
_Avoid_: Live Stamp reference, message stamp ID

**StampAsset**:
The immutable bytes named by a SHA-256 digest and rendered by a StampRevision
or MessageStampSnapshot.
_Avoid_: Mutable media URL

**StampOffer**:
A storefront-specific set of price, region, and grant conditions for one
StampPack; it is not part of the pack's content identity.
_Avoid_: Pack price
