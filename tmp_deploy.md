# Cloudflare Workers 縺ｸ縺ｮ繝・・繝ｭ繧､・医お繝・ず繝ｻ繝励Ο繧ｭ繧ｷ讒区・・・
Takos 縺ｮ繝舌ャ繧ｯ繧ｨ繝ｳ繝峨・ MongoDB 縺ｪ縺ｩ縺ｫ萓晏ｭ倥＠縺ｦ縺翫ｊ縲，loudflare Workers 縺ｮ螳溯｡檎腸蠅・ｼ・CP 荳榊庄・峨∈逶ｴ謗･遘ｻ讀阪☆繧九・縺ｯ蝗ｰ髮｣縺ｧ縺吶ゅ◎縺薙〒譛ｬ繝ｪ繝昴ず繝医Μ縺ｧ縺ｯ縲∽ｻ･荳九・讒区・繧堤畑諢上＠縺ｾ縺励◆縲・
- 髱咏噪繝輔Ο繝ｳ繝茨ｼ・app/takos_host/client/dist`・峨・ Workers Assets 縺九ｉ驟堺ｿ｡
- 蜍慕噪 API・・/auth/*`, `/user/*` 縺ｪ縺ｩ・峨・譌｢蟄倥・ Deno 繝帙せ繝医∈繝励Ο繧ｭ繧ｷ

縺薙ｌ縺ｫ繧医ｊ縲，loudflare Workers 蛛ｴ縺ｯ繧ｨ繝・ず CDN 縺ｨ縺励※讖溯・縺励∵里蟄倥し繝ｼ繝舌・縺ｮ蜑肴ｮｵ縺ｫ鄂ｮ縺丞ｽ｢縺ｧ蜍穂ｽ懊＠縺ｾ縺吶・
## 1. 蜑肴署

- Deno v1.28 莉･荳奇ｼ域悽繝ｪ繝昴ず繝医Μ縺ｮ髢狗匱蜑肴署・・- Wrangler・・loudflare Workers CLI・・
```sh
npm i -g wrangler
```

## 2. 繝輔Ο繝ｳ繝医ｒ繝薙Ν繝・
```sh
cd app/takos_host/client
deno task build
```

蜃ｺ蜉帙・ `app/takos_host/client/dist` 縺ｫ逕滓・縺輔ｌ縺ｾ縺呻ｼ・orkers Assets 縺悟盾辣ｧ・峨・
## 3. ORIGIN_URL 繧定ｨｭ螳・
Workers 縺九ｉ蜍慕噪 API 繧定ｻ｢騾√☆繧区里蟄・Deno 繧ｵ繝ｼ繝舌・縺ｮ URL 繧定ｨｭ螳壹＠縺ｾ縺吶・
```sh
cp .dev.vars.example .dev.vars
# 繧ｨ繝・ぅ繧ｿ縺ｧ ORIGIN_URL 繧呈里蟄倥し繝ｼ繝舌・縺ｫ蜷医ｏ縺帙※螟画峩
```

縺ｾ縺溘・ `wrangler.toml` 縺ｮ `[vars]` 縺ｧ謖・ｮ壹＠縺ｦ繧よｧ九＞縺ｾ縺帙ｓ縲・
譌｢蟄倥し繝ｼ繝舌・・医が繝ｪ繧ｸ繝ｳ・峨・騾壼ｸｸ谺｡縺ｮ繧医≧縺ｫ襍ｷ蜍輔＠縺ｾ縺・

```sh
deno run -A app/takos_host/main.ts
# 縺ｾ縺溘・蠢・ｦ√↓蠢懊§縺ｦ deno task dev 縺ｪ縺ｩ
```

## 4. 繝ｭ繝ｼ繧ｫ繝ｫ縺ｧ襍ｷ蜍・
```sh
wrangler dev
```

`/user` 縺ｨ `/auth` 縺ｯ髱咏噪 SPA 繧帝・菫｡縺励～/user/*` 縺ｨ荳ｻ隕√↑ `/auth/*` API 縺ｯ ORIGIN_URL 縺ｸ繝励Ο繧ｭ繧ｷ縺輔ｌ縺ｾ縺吶・
### app/dev 縺九ｉ縺ｮ繝槭Ν繝√ユ繝翫Φ繝域､懆ｨｼ・・orkers 邨檎罰・・
dev 逕ｨ縺ｮ 2 縺､縺ｮ繝帙せ繝茨ｼ・host1.local`, `host2.local`・峨ｒ Workers 縺ｧ讓｡謫ｬ縺ｧ縺阪∪縺吶ＡTENANT_HOST` 縺ｫ繧医ｊ `x-forwarded-host` 繧貞ｼｷ蛻ｶ縺励∪縺吶・
```sh
# 譌｢蟄・Deno 繧ｵ繝ｼ繝舌・繧定ｵｷ蜍包ｼ亥腰荳繝励Ο繧ｻ繧ｹ縺ｧ OK縲ゅユ繝翫Φ繝医・繝倥ャ繝縺ｧ蛻・崛・・deno run -A app/takos_host/main.ts

# Workers 蛛ｴ・医ち繝・・・deno task --cwd app/dev workers:host1

# Workers 蛛ｴ・医ち繝・・・deno task --cwd app/dev workers:host2
```

縺ｩ縺｡繧峨ｂ蜷後§繧ｪ繝ｪ繧ｸ繝ｳ・・ORIGIN_URL`・峨∈霆｢騾√＠縺ｾ縺吶′縲～TENANT_HOST` 縺ｫ繧医ｊ `host1.local` / `host2.local` 縺ｨ縺励※繝・リ繝ｳ繝郁ｧ｣豎ｺ縺輔ｌ縺ｾ縺吶・
## 5. 繝・・繝ｭ繧､

```sh
wrangler deploy
```

## 繝ｫ繝ｼ繝・ぅ繝ｳ繧ｰ縺ｮ讎りｦ・
- GET `/user` 竊・`index.html`・・ssets・・- GET `/user/*` 竊・蜈医↓ Assets・・/user` 繧貞翁縺後＠縺ｦ驟堺ｿ｡・会ｼ・04 縺ｪ繧・ORIGIN 縺ｸ
- GET `/auth` 竊・`index.html`・・ssets・・- GET `/auth/*` 竊・蜈医↓ Assets・・/auth` 繧貞翁縺後＠縺ｦ驟堺ｿ｡・会ｼ・04 縺ｪ繧・ORIGIN 縺ｸ
- 髱・GET/HEAD 縺ｯ蜈ｨ縺ｦ ORIGIN 縺ｸ・・/user/*` 縺ｯ繝代せ繧貞翁縺後＠縺ｦ霆｢騾・ｼ・- `/oauth*`, `/actor`, `/inbox`, `/outbox`, `/.well-known/*` 縺ｯ ORIGIN 蜆ｪ蜈・- 荳願ｨ倅ｻ･螟悶・ GET 竊・蜈医↓ Assets・・04 縺ｪ繧・ORIGIN 竊・縺輔ｉ縺ｫ 404 縺ｪ繧・`index.html`

蠢・ｦ√↓蠢懊§縺ｦ `app/takos_host/worker.ts` 繧呈僑蠑ｵ縺励※縺上□縺輔＞・井ｾ・ 莉悶・ API 繧偵・繝ｭ繧ｭ繧ｷ縺ｸ霑ｽ蜉・峨・
陬懆ｶｳ: Worker 縺ｯ繧ｪ繝ｪ繧ｸ繝ｳ縺ｸ霆｢騾√☆繧矩圀縺ｫ `x-forwarded-host` 縺ｨ `x-forwarded-proto` 繧剃ｻ倅ｸ弱＠縺ｾ縺吶ゅし繝ｼ繝舌・蛛ｴ縺ｯ `x-forwarded-host` 繧貞━蜈医＠縺ｦ繝・リ繝ｳ繝郁ｧ｣豎ｺ繧定｡後＞縺ｾ縺呻ｼ・app/takos_host/utils/host_context.ts:78` 莉倩ｿ代・ `getRealHost` 繧貞盾辣ｧ・峨・
## Host API 繧・Workers 縺ｧ逶ｴ謗･謠蝉ｾ幢ｼ・1 + R2・・
takos host 縺ｮ API・・/auth/*`, `/user/*`・峨ｒ Cloudflare Workers 荳翫〒逶ｴ謗･謠蝉ｾ帙☆繧句・蜿｣繧ら畑諢上＠縺ｦ縺・∪縺吶・
- 繧ｨ繝ｳ繝医Μ: `app/takos_host/host_api_worker.ts`
- DB: D1・医ヰ繧､繝ｳ繝・ぅ繝ｳ繧ｰ `TAKOS_HOST_DB`・・- 繧ｪ繝悶ず繧ｧ繧ｯ繝医せ繝医Ξ繝ｼ繧ｸ: R2・・OBJECT_STORAGE_PROVIDER=r2`, `R2_BUCKET=<binding>`・・
謇矩・

1) D1 繧剃ｽ懈・縺励せ繧ｭ繝ｼ繝槭ｒ驕ｩ逕ｨ

```sh
wrangler d1 create takos_host
wrangler d1 execute <DB_NAME> --file app/takos_host/db/d1/schema.sql
```

2) R2 繝舌こ繝・ヨ繧剃ｽ懈・・・[[r2_buckets]]` 繝舌う繝ｳ繝・ぅ繝ｳ繧ｰ繧・wrangler.toml 縺ｫ險ｭ螳夲ｼ・
3) 繝ｭ繝ｼ繧ｫ繝ｫ襍ｷ蜍包ｼ・ost1/host2 繝・リ繝ｳ繝域Φ螳夲ｼ・
```sh
deno task --cwd app/dev workers:api:host1
deno task --cwd app/dev workers:api:host2
```

host_api_worker 縺ｯ襍ｷ蜍墓凾縺ｫ D1 繧・`setStoreFactory(createD1DataStore)` 縺ｧ蟾ｮ縺苓ｾｼ縺ｿ縲ヽ2 繝舌う繝ｳ繝・ぅ繝ｳ繧ｰ繧・`globalThis[env.R2_BUCKET]` 縺ｫ蜈ｬ髢九＠縺ｦ `createObjectStorage` 縺悟茜逕ｨ縺ｧ縺阪ｋ繧医≧縺ｫ縺励∪縺吶・
