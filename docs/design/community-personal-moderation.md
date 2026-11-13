# Community chat personal moderation

The authenticated community message page applies the same current viewer
block/mute and operator moderation predicate as other content readers, in SQL
before the existing cursor and page limit. Hidden retained messages do not
consume a page. A different member's view is unchanged, and removing a personal
relation makes retained allowed history visible again without rewriting it.

Community unread counts apply that same current viewer predicate in both the
shared total and the grouped contacts count. Personally blocked/muted senders,
including retained equivalent actor spellings, do not contribute to that
viewer's badge; another member's count is unchanged. Removing the relation
restores still-unread retained messages without altering membership or read
receipts. The shared total continues to supply the badge endpoint and the
existing push/realtime unread snapshot consumers.

Community contact previews apply that viewer predicate before the existing
global recent-chat query limit. A suppressed latest sender falls back to the
latest allowed chat in the selected results; a community with no allowed chat
has no preview or preview timestamp. Other members and DM previews are
unchanged. Removing the relation restores retained previews without changing
messages, membership or read state. The existing global query limit remains;
this does not add an unbounded per-community history search.

After a successful community message write, the existing best-effort realtime
member selection excludes viewers who currently block or mute the sender.
The existing normalized personal-identity SQL predicate correlates each member
with that member's relations; no JavaScript member-ID list or new lookup cache
is introduced. The original community-only query first selects at most 200
member candidates in a derived table; the personal predicate applies outside
that bounded set. Suppressed candidates are not replaced by later members, so
filtering preserves the original candidate-work bound and can emit fewer than
200 messages. Selection order and after-response behavior remain unchanged.
Both `talk.message` and its immediate `unread` event use this selected set. The
sender's separate decision to block another member does not revoke that member's
community membership or read permission.

The message, audience recipient, Create activity, last-message timestamp and
push job persistence remain unchanged. Filtering is a viewer-specific choice,
not a new permission to post, edit, delete or read private communities. Existing
author/manager roles, admission guards, revisions and atomic writes are unchanged.
A selection failure emits no realtime events through this task and follows the
existing best-effort error handling after the committed write.

This change does not alter DM preview/count SQL, observed-read
authority, existing unread event triggers or push-delivery rechecks. Those
paths require separate qualification. A relation changing
after selection is not atomically rechecked at event delivery. Large-community
fanout beyond the existing cap, query cost under real data, genuine sessions,
real Durable Objects/Queue, installed consumers and deployment remain separate.
