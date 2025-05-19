## /_takos/friend/follow

req: { userId: string, }

res: { type: "accepted" or "requested" or "rejected" }

## /_takos/friend/unfollow

req: { userId: string }

res: { ok: bool }

## /_takos/friend/requestes

req: { userId: string, result: bool }
