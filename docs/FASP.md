# takos × Fediscovery（FASP）統合・Service Actor実装 仕様案

## 0. 目的と範囲

- **目的**

  - takos に
    Fediscovery（FASP）クライアント機能を接続し、検索・発見（Discovery）機能を強化。
  - takos host に **Service Actor**
    を実装し、従来のリレーサーバー代替として「フォロー可能な配信ハブ」を提供。
  - takos host が従来提供していたリレーサーバー機能を廃止し、Service Actor
    配信へ移行（外部リレーへの参加機能は維持）。

- **スコープ**

  - **takos**: FASP
    **クライアント機能**（プロバイダ情報取得・capability管理・Discovery
    API呼び出し）の実装。
  - **takos host**: **Service
    Actor**（ActivityStreamsの`Service`/`Application`）のみを公開し、**フォロー/Accept/配信**を行う。
  - FASP **Discovery**のうち **data\_sharing** / **trends** /
    **account\_search** 対応。
  - 詳細仕様は `docs/fasp/general/v0.1/` および `docs/fasp/discovery/` を参照。

---

## 1. 用語

- **FASP**: Fediverse Auxiliary Service
  Provider。外部の補助サービス（検索、スパム対策など）。
- **Capability**: FASPが提供する機能単位（例：`data_sharing`, `trends`,
  `account_search`, `debug`）。
- **Service Actor**:
  ActivityStreamsのActor型の一つ。サーバ側ソフトやボット等に用いられる。takos
  hostでは**フォロー可能なサービス用Actor**として公開する。 ([W3C][1])

---

## 2. 全体アーキテクチャ

- **構成要素**

  - **takos Core**：既存アプリケーション。
  - **takos FASP Client**：FASP
    クライアント機能（プロバイダ情報取得・capability管理・Discovery
    API呼び出し）。
  - **takos host Service Actor**：`https://{takos-host}/actor`
    に公開。inbox/outbox、公開鍵、フォロー受付、配信制御のみ。
  - **FASP（Discovery Provider）**：外部サービス。

- **役割分担**

  - **takos**: FASP プロバイダとの通信、Discovery API の利用、検索結果の表示。
  - **takos host**: Service Actor としての配信ハブ機能のみ提供。FASP
    との直接通信は行わない。

- **ベースURLの取り決め**

  - takos は `.well-known/nodeinfo` の `metadata.faspBaseUrl` に takos
    側FASPクライアントAPIのベースURLを掲載。例：`"faspBaseUrl": "https://{takos-instance}/fasp"`。
  - takos host は Service Actor のエンドポイント `https://{takos-host}/actor`
    のみ提供。
  - FASP 情報 API `provider_info` は `https://{FASPドメイン}/fasp/provider_info`
    のみを参照し、`.well-known` などのフォールバックは行わない。

---

## 3. セキュリティ / 認証

- **メッセージ完全性**

  - すべてのリクエストに `Content-Digest`（RFC 9530,
    SHA-256）を付与。受信側は検証必須。
- **相互認証**

  - **HTTP Message Signatures（RFC 9421）**、アルゴリズム **ed25519**
    を使用。`@method`,`@target-uri`,`content-digest`
    をカバー。レスポンス署名では `@status` を使用。`keyid`
    は登録時に交換したID。
- **ダブルノッキング（取得系互換性）**

  - FASP/Service Actor が外部のAPサーバからオブジェクト取得を行う場合、まず RFC
    9421 で試行し、401/403なら旧 **draft-cavage HTTP Signatures**
    で再試行（互換性確保）。実装はサーバごとに結果をキャッシュ。
- **レート制限**

  - 429 + `Retry-After` を使用。クライアントは尊重する。

---

## 4. FASP General 実装（takos クライアント機能）

### 4.1 登録フロー（FASP ↔ takos）

1. 管理者がFASP上でtakosを登録（FASPが takos の `.well-known/nodeinfo`
   を参照して `faspBaseUrl` を把握）。
2. FASP → takos：`POST /registration`

   ```json
   {
     "name": "Example FASP",
     "baseUrl": "https://fasp.example.com",
     "serverId": "b2ks…",
     "publicKey": "Base64-Ed25519-PubKey"
   }
   ```

   takosは FASP登録要求を保存し、自身の公開鍵と
   `faspId`、`registrationCompletionUri` を返す。登録情報の保存には
   `registrationUpsert` ヘルパーの実装が必須であり、`registrationCompletionUri`
   は takos 側の管理 API `https://{takos-instance}/api/fasp/providers`
   を指し、管理者はここから承認・capability 設定を実施する。
3. 管理者は takos 管理UIで**指紋（FASP公開鍵のSHA-256
   Base64）**を確認し、受理/拒否を決定。
4. 受理後、能力（capability）選択へ。

### 4.2 Capability 選択

- takos → FASP：`GET /provider_info` で capabilities を取得し、管理UIでON/OFF。
- ON時：takos →
  FASP：`POST /capabilities/<identifier>/<version>/activation`。OFF時：`DELETE`。
  - `provider_info` は `https://{FASPドメイン}/fasp/provider_info`
    のみに存在する前提。

---

## 5. Discovery Capabilities 実装（takos クライアント機能）

### 5.1 `data_sharing v0.1`

**役割分担**

- **FASP ⇒ takos（受信）**

  - takos が FASP からの data_sharing リクエストを受信し、処理する。
  - `POST /data_sharing/v0/event_subscriptions`
  - `POST /data_sharing/v0/backfill_requests`
  - `DELETE /data_sharing/v0/event_subscriptions/{id}`

- **takos ⇒ FASP（送信）**

  - takos が FASP にデータ送信を行う。
  - **アナウンス**：`POST {FASP}/data_sharing/v0/announcements`

    - body:

      ```json
      {
        "source": { "subscription": { "id": "…" } | "backfillRequest": { "id": "…" } },
        "category": "content" | "account",
        "eventType": "new" | "update" | "delete" | "trending",
        "objectUris": ["https://…", "https://…"],
        "moreObjectsAvailable": true|false  // backfill時
      }
      ```
    - 204 を期待。

**制約**

- 送信は **URIのみ**（本体は送らない）。FASP側が取得する。
- takos は
  **公開・検索許可（discoverable）**のみ共有。**非公開・未許可**は共有禁止。
- FASP側は `to:` を確認し公開対象のみ処理。
- 検索許可の判定は **FEP-5feb** に従う。

**FASPによる取得（参照）**

- FASPは受け取ったURIに対し
  `Accept: application/ld+json; profile="https://www.w3.org/ns/activitystreams"`
  でGET。
- 署名は RFC 9421（必要に応じ
  cavage-12）で、**FASPは「サーバ/インスタンスActor」として署名**（`/actor`に公開鍵）。

### 5.2 `trends v0.1`（takos クライアント機能）

- **takos → FASP API 呼び出し**

  - `GET /trends/v0/content?withinLastHours=1..168&maxCount&language`
  - `GET /trends/v0/hashtags?...` / `GET /trends/v0/links?...`
- **応答処理**

  - `content`: `[{uri, rank}]`（`rank`は1..100、降順）の処理。
  - ハッシュタグ/リンクは正規化はFASP側裁量、takos側は自サーバ内の既存ロジックと同等に処理。

### 5.3 `account_search v0.1`（takos クライアント機能）

- **takos → FASP API 呼び出し**
  - `GET /account_search/v0/search?term=...&limit=...`
- **応答処理**
  - 200で **Actor URI配列**を受信。`Link: rel="next"` によるページング対応。
  - takosは返却URIをキャッシュし、必要に応じフォロー/プロフィール取得を行う。

---

## 6. takos host の **Service Actor** 仕様

### 6.1 公開エンドポイント

- **Actor**：`GET https://{takos-host}/actor`

  - 例（最小構成）：

    ```json
    {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1"
      ],
      "id": "https://{takos-host}/actor",
      "type": "Service", // or "Application"
      "preferredUsername": "takos",
      "inbox": "https://{takos-host}/inbox",
      "outbox": "https://{takos-host}/outbox",
      "publicKey": {
        "id": "https://{takos-host}/actor#main-key",
        "owner": "https://{takos-host}/actor",
        "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
      }
    }
    ```
  - `type` は AS2の**Service**（サービス用途）または
    **Application**（アプリケーション用途）を選択可。用途上は **Service** 推奨。
    ([W3C][1])

- **inbox/outbox**

  - `inbox`：受信（Follow、Undo、Block等）を処理。
  - `outbox`：配信（Accept、Announce/Forward等）を発行。

### 6.2 Service Actor のフォローと配信

- **Follow受付**

  - 受領：`Follow{ actor: <follower>, object: <takos-actor> }`
  - 応答：`Accept(Follow)` を outbox から配信。
- **配信方針**

  - takos が把握する **公開・discoverable** な新規/更新コンテンツの **URI**
    を、フォロワーへ **Announce**（または必要に応じて元オブジェクトの配信）

    - フィルタ：ローカル投稿＋連合経由で知り得たリモート投稿のうち、公開・許可済のみ。
    - バッチ/しきい値：FASP `data_sharing` の
      `trends`/しきい値と整合性あるバッチングを推奨（過剰配信を回避）。
- **ブロック/オプトアウト**

  - サーバ単位・アカウント単位での除外リストを適用（inboxでのBlock/Undoを尊重）。
- **レート制御**

  - outbox配送をQ化し、429/Retry-Afterを尊重。

> 補足：従来の“リレー”は投稿本文を転送する実装も存在しますが、本仕様では
> **URI中心**
> の共有を基本とし、本文取得はフォロワー側の既存APフェッチに委譲します（Fediscoveryの設計に整合）。

---

## 7. takos 実装詳細

### 7.1 takos（クライアント機能）設定例

```yaml
fasp:
  enabled: true
  providers:
    - name: "Example FASP"
      base_url: "https://fasp.example.com"
      capabilities:
        data_sharing: "0.1"
        trends: "0.1"
        account_search: "0.1"
```

### 7.2 takos API（FASP登録・管理用）

- FASP → takos（受信、署名必須）
  - `POST /fasp/registration`（FASP登録要求受理）
  - `POST /fasp/data_sharing/v0/event_subscriptions`
  - `DELETE /fasp/data_sharing/v0/event_subscriptions/{id}`
  - `POST /fasp/data_sharing/v0/backfill_requests`
  - `POST /fasp/data_sharing/v0/backfill_requests/{id}/continuation`
  - 認証・保全: HTTP Message Signatures（RFC 9421）と `Content-Digest`（RFC
    9530）による検証を必須。`Content-Digest` が無いリクエストは 401 を返す。

- 管理（takos の通常 API 配下、要ログイン）
  - `GET /api/fasp/providers`（一覧）
  - `GET /api/fasp/providers/{serverId}`（詳細）
  - `POST /api/fasp/providers/{serverId}/approve`（承認）
  - `POST /api/fasp/providers/{serverId}/reject`（却下）
  - `PUT /api/fasp/providers/{serverId}/capabilities`
    - body 例:
      `{ "capabilities": { "data_sharing": { "version": "0.1", "enabled": true } } }`
  - `GET /api/fasp/providers/{serverId}/provider_info`（FASP の provider_info
    を取得）
  - （オプション）`POST /api/fasp/announcements`（手動アナウンス送信の簡易デバッグ）
  - `POST /api/fasp/providers/discover`（ドメイン/URL を指定して FASP を仮登録）

### 7.3 takos → FASP（クライアント API）

- `GET /provider_info`
- `POST|DELETE /capabilities/<id>/<version>/activation`
- `POST /data_sharing/v0/announcements`
- `GET /trends/v0/content|hashtags|links`
- `GET /account_search/v0/search`

実装メモ：`POST /data_sharing/v0/announcements` は takos から FASP へ
公開オブジェクトの URI のみを共有する。`Content-Digest` を付与。

### 7.4 takos host（Service Actor のみ）設定例

```yaml
service_actor:
  enabled: true
  actor_url: https://{takos-host}/actor
  type: Service # または Application
  deliver_batch_size: 20
  deliver_min_interval_ms: 200
  allow_instances:
    - "*"
  deny_instances: []
```

### 7.5 takos host API（Service Actor 関連のみ）

- `GET /actor`（Service Actor 公開）
- `POST /inbox`（Follow/Undo/Block 受信）
- `GET /outbox`（Accept/Announce 配信）

メモ：Follow 受領時、`Accept(Follow)` を Service Actor の鍵で署名して返信する。

### 7.6 Nodeinfo 例（takos）

```json
{
  "version": "2.0",
  "software": { "name": "takos", "version": "x.y.z" },
  "protocols": ["activitypub"],
  "openRegistrations": false,
  "metadata": {
    "faspBaseUrl": "https://{takos-instance}/fasp"
  }
}
```

---

## 8. プライバシー/コンプライアンス

- **共有可能範囲**：公開かつ**discoverable**に同意済みのもののみ（未許可/非公開/Quiet
  Public/Unlistedは共有禁止）。FASP側も同条件で保存/索引。判定は **FEP-5feb**
  を使用。
- **検索語の扱い**：`account_search`
  では、takosが**検索語**をFASPへ送る可能性があるため、プライバシーポリシーに明記。

---

## 9. 運用

- **監視**：署名検証失敗・429・タイムアウト・アナウンス配送遅延をメトリクス化。
- **リトライ**：指数バックオフ。429は`Retry-After`準拠。
- **互換性**：ダブルノッキング結果をサーバ単位でキャッシュし、一定期間で再検証。

---

## 10. 実装メモ（最小プロトタイプ）

### takos host (Service Actor のみ)

- Service Actor 公開（`/actor`）とinbox/outboxの実装。
- Follow受付・Accept配信の最小フロー。

### takos (クライアント機能のみ)

- Nodeinfoに `faspBaseUrl` を追加。
- FASP Registration とCapability有効化の往復。
- `data_sharing`の event\_subscriptions/backfill
  受理・`announcements`送信の最小フロー。
- `trends`/`account_search` のクライアント呼び出しとUI表示。

---

## 11. takos host のリレーサーバー機能廃止

FASP の Service Actor 配信へ移行するため、takos host
がリレーサーバーとして動作する機能を廃止する。外部リレーに参加する機能は今後も提供する。

### API / CLI の更新

- `scripts/host_cli.ts` から `relay-*` コマンドを削除し、takos host
  でのリレーサーバー運用を停止する。
- takos host 専用のリレー関連 API
  やデータモデル（例：`app/api/models/takos_host/relay.ts`）を削除する。

### DB コレクションの取り扱い

- `hostrelays` など takos host 専用のコレクションは参照されなくなる。
- 必要な情報があればバックアップして Service Actor
  側へ移行した後、コレクションを削除する。不要であればそのまま破棄してよい。

### ドキュメントの更新

- takos host がリレーサーバーとして振る舞う旨を記載しているドキュメントや README
  を更新し、誤解を避ける。

---

## 参考

- FASP General（Intro/Protocol/Registration/Provider Info）
- FASP Discovery: **data\_sharing** / **trends** / **account\_search**
- ActivityStreams Actor Types（`Service` 含む） ([W3C][1])

[1]: https://www.w3.org/TR/activitystreams-vocabulary/#actor-types
