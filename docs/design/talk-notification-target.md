# Talk notification target resolution

The authenticated `GET /api/dm/notification-target` resolves one opaque push
`event_id` (a stored Create activity AP ID) to a currently available user or
community chat. Optional `object_id` cross-checks the push `room_id`, which is a
message object AP ID, not a conversation or Group identity. Both IDs are exact
single query values of 1–2048 characters without surrounding whitespace or
control characters. The server never dereferences either ID.

A successful response is:

```json
{
  "event_id": "https://host.example/ap/activities/create",
  "recipient_ap_id": "https://host.example/ap/users/me",
  "target": { "type": "user", "ap_id": "https://peer.example/ap/users/peer" }
}
```

The authenticated actor supplies the recipient. The stored Create actor must
equal its Note's author. Direct targets require that actor's indexed recipient
edge and current pair archive/moderation eligibility. Community targets require
the message's audience edge, a live community and the recipient's current
membership. Community feed posts are excluded. A single SQL snapshot unions
the candidates, caps the result at two rows and returns a target only when
exactly one is eligible. Missing, removed, ineligible and ambiguous targets all
return the same 404. Invalid input returns 400; missing authentication returns
401. All responses use `Cache-Control: no-store`.

This GET returns no message body or profile, makes no remote request, and does
not acknowledge reading, mark an inbox entry, create a chat or unarchive it.
Actual contact/message calls must still authorize current access. A client
must fence the result to its selected account and match `recipient_ap_id` to
that account's authenticated actor before opening the native conversation.
Unavailable or failed resolution leaves the conversation list usable and must
not be turned into a guessed target or automatic write/retry.

The existing `event_id_only` gateway payload and its privacy remain unchanged.
This source contract alone does not establish serving-version adoption, genuine
push delivery, native device lifecycle, or package publication.
