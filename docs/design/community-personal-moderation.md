# Community chat personal moderation

The authenticated community message page applies the same current viewer
block/mute and operator moderation predicate as other content readers, in SQL
before the existing cursor and page limit. Hidden retained messages do not
consume a page. A different member's view is unchanged, and removing a personal
relation makes retained allowed history visible again without rewriting it.

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

This change does not alter the shared unread-count or contact-preview SQL,
observed-read authority, existing unread events triggered by other operations,
or push-delivery rechecks. Those consumers require separate qualification and
may still reflect retained personally hidden messages. A relation changing
after selection is not atomically rechecked at event delivery. Large-community
fanout beyond the existing cap, query cost under real data, genuine sessions,
real Durable Objects/Queue, installed consumers and deployment remain separate.
