<!--
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Runtime lanes — 同じ bundle を raw binding と portable facade の両方で動かす

Status: **実装済み**（`src/backend/runtime/lane.ts` ほか。test は
`src/backend/__tests__/runtime/`）
Shipped in: `@takosjp/yurucommu-core` / `@takosjp/yurucommu-api` **4.1.0**
Owner: `yurucommu-core`
Consumers: `yurucommu`, `yurumeet`（Worker entry の composition）

同一の Worker bundle が、内側からは見分けのつかない 2 つの backend で動きます。

| lane | binding を projection する host | `env.DB` | `env.KV` | `env.MEDIA` | `env.DELIVERY_QUEUE` |
| --- | --- | --- | --- | --- | --- |
| `cloudflare` | Cloudflare Workers へ直接 deploy、および ordinary Workers の Takoserver backend | `D1Database` | `KVNamespace` | `R2Bucket` | `Queue` |
| `portable` | wrapper host（self-host、managed Workers-for-Platforms） | `edge.sql@1.0.0` | `edge.kv@1.0.0` | `edge.objects@1.0.0` | `edge.queue@1.0.0` |

**lane が名指すのは binding の形であって、Worker を publish した道具ではありません。**
本番の Takoserver backend は ordinary Workers なので `kv_namespace` / `d1` /
`r2_bucket` / `queue` / `service` を **そのまま** projection します。これは
`cloudflare` lane です。facade が現れるのは wrapper host、つまり self-host と managed
Workers-for-Platforms だけで、そこでは host が生成した entrypoint が module より先に
`env` を差し替え、各 binding は Worker Version が宣言した Interface の
**portable facade** になります。両 wrapper は同じ facade を projection します
（同じ method、同じ option 名、同じ error 名）。Takoserver ADR 0005 が object storage
について明言し、self-host wrapper が KV と SQL について同じことを繰り返しています。

Takoform で書いた deployment はどちらの host にも着地しうるので、lane を IaC の語彙で
呼ぶことはできません。

## lane は宣言する。推測しない

binding の 5 つのうち **2 つは形で区別できません**。`edge.kv` と `KVNamespace` は
同じ 5 つの method 名を持ち、queue producer はどちらも `send` / `sendBatch` です。
推測した Worker は facade に `kv.get(key, {type:"json"})` を渡し、facade は第 2 引数を
無視して bytes を返すので、失敗はずっと後から「壊れた session」「発火しない rate limit」
として現れます。

そこで lane は plain var `YURUCOMMU_RUNTIME_LANE` で宣言し、**識別できる binding で
突き合わせます**。値は `cloudflare` と `portable` の 2 つだけで、未設定は
`cloudflare` です。知らない値は default に落とさず起動を拒否します。alias はありません
——旧称 `takoform-v1` もいまは「知らない値」であり、まだそれを宣言している deployment は
黙って別の binding 形で動かされるのではなく、起動に失敗します。

- `DB` は両方向に decisive — `execute`/`query`/`transaction` と `prepare`/`batch` は
  互いに素です。
- `MEDIA` は片方向に decisive — `R2Bucket` は multipart helper で見分けられます。
- 宣言と binding が食い違えば `RuntimeLaneError` で起動を拒否します。

設定するのは wrapper host に置くときだけです。self-host と managed
Workers-for-Platforms の deployment は
`worker_plain_values = { YURUCOMMU_RUNTIME_LANE = "portable" }` を設定し、ordinary
Workers の Takoserver backend と Cloudflare 直 deploy は未設定のまま（または
`cloudflare`）にします。

## Worker entry からの使い方

```ts
import {
  wrapRuntimeBindings,
  wrapRuntimeMessageBatch,
  resolveRuntimeLane,
} from "@takosjp/yurucommu-core/server";

export default {
  async fetch(request, bindings, ctx) {
    return app.fetch(request, wrapRuntimeBindings(bindings), ctx);
  },
  async queue(batch, bindings) {
    const lane = resolveRuntimeLane(bindings.YURUCOMMU_RUNTIME_LANE);
    return handleYurucommuQueueBatch(
      wrapRuntimeMessageBatch(batch, lane),
      wrapRuntimeBindings(bindings),
    );
  },
};
```

core の published Worker default export (`@takosjp/yurucommu-core/server` の
`default`) は既に lane-aware です。自前の entry を持たない product は、そのまま
re-export すれば両 lane で動きます。

`wrapCloudflareBindings` / `wrapCloudflareMessageBatch` はこれまで通り残ります。
native binding だけを渡すと分かっている entry はそちらを直接呼んでも構いません。

Durable Object binding (`CALL_SIGNALING` / `REALTIME_STREAM`) はどちらの lane でも
wrapper を素通りします。ただし Takoform の Worker Version form には DO binding が
無いため、`portable` では両方とも未 bind になり、call / realtime route は 503 を
返してクライアントは polling に落ちます。

## lane ごとの差分（app が知っておくべきもの）

### `edge.sql` — row は record であって配列ではない

D1 は Drizzle に位置つき配列を渡し、`sqlite-proxy` は `rows[i][j]` を compile 済み
field へ位置で対応させます。`edge.sql` が返すのは **result column 名を key とする
record** です。Drizzle が生成する join はこうなります。

```sql
select "inbox"."actor_ap_id", ..., "activities"."actor_ap_id", ... from "inbox" inner join "activities" ...
```

SQLite はどちらの result column にも `actor_ap_id` という名前を付けるので、record は
片方だけを残し、以降の field が 1 つずつずれます。**error ではなく静かな誤読**です。

`sqlite-proxy-rows.ts` は送信前に projection list を書き換え、alias を持たない項目
それぞれに一意で非数値な名前（`__c0`, `__c1`, ...）を与えます。Drizzle は result
column 名を見ないので、この rename は Drizzle からは不可視です。さらに **guard** が
付きます: 返ってきた row の column 数が送った projection 項目数と一致しなければ、
ずれた row を返す代わりに `ProxyColumnMismatchError` を投げます。

``db.get(sql`...`)`` のような compile 済み field を持たない raw statement は、driver の
row がそのまま呼び出し側に渡ります。D1 ではそれは record なので、call site は
`row.matched` のように **名前で** 読みます（block / mute の gate がそうしています）。
`sqlite-proxy` が渡すのは素の配列なので、この shared module は column 名を配列に
非列挙 property として付け、位置と名前の両方の読み方が成立するようにします。名前が
無いままだと `undefined` が「block されていない」と読まれます。

- `db.batch([...])` は facade の `transaction()`（all-or-none、1 往復）になります。
- `begin` / `commit` / `savepoint` はこの request path にありません。`db.batch` を
  使ってください（`managed-relational.ts` と同じ制約です）。
- bound parameter は `null | number | string | {encoding:"base64", data}` のみ。
  boolean は 0/1、`Uint8Array` / `ArrayBuffer` は base64 blob になります。
- `select *` は rename できないため書き換えず、column 数の guard も効きません。
  join を伴う `select *` を raw SQL で書かないでください。

### managed relational — 同じ row shape を共有する

Takosumi の managed RelationalDatabase lane（`managed-relational.ts`）は、transport は
`{columns, rows}` の位置つきですが、Drizzle との接続は同じ `sqlite-proxy` です。
projection の書き換え・column 数 guard・名前つき row は `sqlite-proxy-rows.ts` を
`edge.sql` lane と共有します。この lane だけの追加制約は次の 2 つです。

- runtime contract は **trim 済みの statement しか受け取りません**。Drizzle は raw の
  `sql` template を trim しないので、lane が送信前に trim します。
- 結果が 0 行の `get` は空配列ではなく `undefined` を返さなければなりません。Drizzle の
  `mapGetResult` は falsy な row でだけ short-circuit するので、`[]` は「全 field が
  undefined の row」に化けます。

### `edge.kv` — 期限は相対 TTL ひとつだけ

- read は常に bytes。`{type:"text"|"json"|"arrayBuffer"}` の decode は adapter が行います。
- `expiration`（絶対秒）は現在時刻との差から `expirationTtlSeconds` に変換されます。
- TTL の下限は 60 秒（Cloudflare KV 自身の下限でもある）。下回る指定は clamp せず拒否します。
- metadata は **string 値のみ**。string でない値は stringify せず拒否します。
- `list()` は **name しか返しません**。`expiration` と `metadata` は Host が返さないので、
  この lane では常に absent です。「無い」ことから何も推論しないでください。

### `edge.queue` — body は bytes

- Cloudflare Queues と違い structured clone がありません。producer は body を JSON で
  serialize し、consumer 側が同じ encoding で戻します。
- consumer batch は別 object です: `acknowledge` / `acknowledgeAll` /
  `timestampMillis`（`ack` / `ackAll` / `timestamp` ではない）。body は
  `{encoding:"base64", data}` で届きます。
- `retry({delaySeconds: 0})` は facade が拒否するので、0 は省略に変換されます。

### `edge.objects` — R2 より狭い

- custom metadata はありません。core の provider-neutral な `ObjectStore` も
  `contentType` しか運ばないので、両者はここで一致しています。
- streaming `put` には `contentLength` が必要です。ADR 0005 が「Host は宣言された
  byte 数を streaming 中に enforce し、size を知るために body を buffer しない」と
  定めているためです。`ObjectStoreBody` のうち `Blob`（media upload の `File`）・
  `ArrayBuffer`・string は adapter が size を読み取れるので、bytes は buffer されず
  宣言付きで stream します。size を知りようがない裸の `ReadableStream` だけが
  Worker 側で buffer されます。
- `delete` は 1 key ずつ。配列形は逐次呼び出し（重複 key は 1 回）になり、atomic では
  ありません。
- range 指定なしの `get` に Host が `partial` な body を返したら、truncate された bytes
  を完全な object として配ってしまうので、adapter は body を捨てて拒否します。
- enumeration（`list`）と `head` は core の `ObjectStore` に無いので adapter にもあり
  ません。Host は両方 projection しますが、port が使いません。

## binding が無いとき

Takoserver の self-host backend も managed Cloudflare backend も、`edge.kv` /
`edge.objects` / `edge.queue` / `edge.sql` の 4 つを projection します
（`selfhost-worker-wrapper.ts` の `projectEnv`、および
`selfhost-version-bindings.ts` の data binding kinds）。self-host backend は自前の
object store を realize して managed 側と同じ facade を出すので、`portable` lane の
Worker はどちらの host でも `env.MEDIA` を受け取ります。

binding が欠けるのは backend が出せないからではなく、**Version がその binding を宣言
していない**ときです。その場合は、

- `DELIVERY_QUEUE` / `DELIVERY_DLQ` 未 bind → 既存の同期 fallback delivery と readiness 報告
- `MEDIA` 未 bind → 既存の "Object storage unavailable" (503)

という、これまでと同じ挙動になります。
