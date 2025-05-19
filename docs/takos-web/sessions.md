### /_takos/sessions/login

req: { password: string }

res: empty

cookie: sessionid

### /_takos/sessions/logout

req: empty

res: { "ok": ok }

### /_takos/sessions/delete

req: { id: string }

res: { ok: bool }
