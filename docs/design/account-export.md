# Synchronous account export

`GET /api/actors/me/export` exports the authenticated actor's profile, authored
non-deleted posts, following, followers and media manifest. Authentication and
actor scoping are required; it does not export another account's authored data
or include signing keys. This is a portability aid, not a complete backup.

The existing row caps remain: 5,000 posts, 10,000 following, 10,000 followers and
10,000 media entries. Collections still report `total_items` and `truncated`.
Exactly reaching a row cap still marks that collection truncated.

Successful JSON is limited to **8 MiB of encoded UTF-8**, including metadata,
JSON escaping and punctuation. Operators may set `YURUCOMMU_EXPORT_MAX_BYTES`
to a positive decimal integer no greater than 8,388,608 to lower that budget.
Unset uses the default; blank, malformed, zero or larger values return
`503 EXPORT_LIMIT_INVALID` before reading account data. This is an optional
server environment setting; no new secret or database migration is involved.

If the archive exceeds the budget, the route returns **413 EXPORT_TOO_LARGE**
with `max_bytes`, without a download header or a partial archive. It does not
silently discard fields or truncate at the byte boundary. Small exports keep
the existing JSON field names, values and attachment filename.

Collection queries select only exported columns in stable timestamp/identity
order. A page holds at most one eighth of that collection's existing row cap:
625 posts or 1,250 follow/media rows. This bounds both materialization and round
trips: at most eight reads per collection and 33 export reads including the
profile, without lowering row caps. Byte checks happen while assembling items;
a limit failure stops further pages and later collections. The complete JSON
is sent only after successful assembly. There are no new persistent jobs,
cursors, streaming responses, locks, or database writes. The round-trip budget
avoids the repeated-query amplification of very small fixed pages; it does not
qualify a deployment's quota, which also includes its authentication/runtime
work. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

This bounds encoded output and avoids loading every collection together; it
does not set a wall-clock deadline, provide a database snapshot, limit parallel
requests across isolates, or remove the cost of reading/decoding one stored row
or one page. Stable pagination assumes no concurrent data changes. Complete
large-data export and asynchronous retention remain separate work. Portable
SQLite fixtures do not establish actual Worker/D1 resource or runtime limits.
