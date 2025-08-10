# 目的と前提

- 目的: ActivityPub 上で E2EE な会話を **ルーム（Room）**
  という一つの概念で統一実装する。2人会話も多人数会話も同一モデル。
- 前提:

  - 暗号: MLS（RFC9420 系）を使用。配送は ActivityPub（C2S/S2S）。([SWICG][1])
  - 参加者アドレス: ActivityPub Actor の URL。
  - ルーム単位で
    E2EE。サーバは本文を読めないが、宛先と送信者などメタデータは見える（対策は後述）。([SWICG][1])
  - 俯瞰資料: SWICG の統合モデル文書も参照可能。([SWICG][2])
  - 実装上の注意点は [chat_e2ee.md](./chat_e2ee.md) を参照。

---

# UX 要件（最小）

1. ルーム一覧

- 並び順: 最終イベント時刻降順。ピン留め/ミュート/未読バッジ。
- 2人でも多人数でも **同じカード UI**。DM
  という言葉は出さない（2人なら「○○さんとのルーム」表示）。

2. ルーム詳細（会話画面は実装済とのことなので仕様だけ）

- メッセージ、編集・削除、返信（スレッド）、絵文字リアクション、引用、メディア添付、既読位置。
- 既読は「最後に読んだイベント ID」一本化（人ごとの既読カーソル）。
- タイピング表示（任意）。
- ルーム情報: 名前・アイコン（任意）、メンバー一覧、招待リンク（任意）。

3. メンバー管理

- 招待・参加・退出・追放。
- ルームは常に **明示メンバー制**（followers や as\:Public
  には送らない）。([SWICG][1])

---

# ドメインモデル

- Room

  - room\_id: クライアント生成 UUID（表示用に別途 slug 可）
  - members: Actor URL 配列
  - mls\_group\_state: MLS のグループ状態（ローカル安全領域に保存）
  - metadata: name / avatar / is\_two\_party（ローカルフラグ）/ mute / pinned
    など（すべてクライアント側ローカル or 暗号化アプリデータ）

- Member

  - actor: Actor URL
  - devices: 相手デバイスの公開 KeyPackage キャッシュ（後述）

- Message（イベント）

  - event\_id: UUID（アプリデータ側）
  - type: note | image | file | reaction | read | typing | membership など
  - content: AS2 オブジェクト（暗号化して MLS PrivateMessage
    に内包）([SWICG][1])
  - relates\_to: 返信元/リアクション対象の event\_id
  - local\_status: sending / sent / failed

- Device/Keys

  - 自デバイス: MLS 鍵（安全領域）
  - 相手: Actor の `keyPackages` コレクションから取得/更新（AP
    側の公開ディレクトリ）。([SWICG][1])

---

# ワイヤ仕様（外側: ActivityPub / 内側: MLS / 最内: AS2）

## 1) 送信（AP エンベロープ）

- AP `Create` を **自分の outbox** に POST。
- 宛先は **全メンバーの Actor URL を明示**して `to`/`cc`
  に列挙（コレクション宛は不可）。([SWICG][1])
- `object` は
  `type: ["Object","PrivateMessage"]`、`mediaType: "message/mls"`、`encoding: "base64"`、`content`
  に **MLS PrivateMessage の base64**
  を入れる（サーバは中身を理解不要）。([SWICG][1])
- グループ操作用の MLS `Proposal` や `Commit` などは
  `type: ["Object","PublicMessage"]` を用い、内容は MLS PublicMessage の base64
  とする。名前の "Public" は公開投稿の意味では
  なく、暗号化されないハンドシェイクメッセージを示す。

#### 例（AP エンベロープ・概略）

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls"
  ],
  "type": "Create",
  "actor": "https://alice.example/users/alice",
  "to": ["https://bob.example/users/bob"],
  "object": {
    "type": ["Object", "PrivateMessage"],
    "mediaType": "message/mls",
    "encoding": "base64",
    "content": "BASE64_OF_MLS_PrivateMessage"
  }
}
```

（構造は SWICG ドキュメントの例に準拠。実際の `id`
はサーバ付与でもよい。）([SWICG][1])

## 2) 受信

- サーバは通常の AP 配送/永続化のみ実施。クライアントは `inbox`
  から取得し、`content`（MLS）を復号してアプリデータ（AS2）を得る。([SWICG][1])

## 3) アプリデータ（最内: AS2 プロファイル）

- テキスト: `Note`、長文: `Article`、メディア:
  `Image`/`Audio`/`Video`/`Document`。ID は HTTPS でなくてもよい（UUID
  推奨）。`likes`/`shares`/`replies`
  はサーバに依存しないので未使用。([SWICG][1])
- 既読: `Read`（対象オブジェクトの ID を参照）。視聴・閲覧は
  `Listen`/`View`。([SWICG][1])
- ノイズ用の空メッセージは `IntransitiveActivity` を利用可（任意）。([SWICG][1])

---

# ルーム／メンバーのライフサイクル

## ルーム作成

1. クライアントが新規 MLS グループを作成。
2. 参加者の Actor から `keyPackages` コレクションを取得し、加入 Proposal
   を作成。([SWICG][1])
3. 生成された `Welcome`/`GroupInfo` を **各参加者に AP `Create`
   で配送**。以後、通常の PrivateMessage でやり取り。([SWICG][1])

MLS のグループ操作（`Proposal` や `Commit`）は `PublicMessage`
として送信し、宛先はメンバーに限定する。

## 招待（メンバー追加）

- 招待対象の `KeyPackage` を取得 → MLS `Add` → `Welcome` を
  **招待先にだけ**送付（AP で宛先をその Actor に限定）。([SWICG][1])

## 退出・追放

- MLS `Remove`
  を適用し、以後のメッセージは新キーで暗号化（過去は復号不可のまま）。([SWICG][1])

---

# メッセージ機能の仕様

- 投稿: AS2 `Note`（HTML 可。クライアントで HTML サニタイズ必須）。([SWICG][1])
- 返信/スレッド: `inReplyTo` に対象 `id`。
- 編集: AS2 `Update`（対象 `id` 指定、差分ではなく全体更新推奨）。
- 削除/取り消し: AS2 `Delete`（トゥームストーン）。
- リアクション: `as:Like`（または拡張 `EmojiReaction` を定義して `content`
  に絵文字）。
- 既読: `Read`（最後に読んだイベントの `id`）。
- タイピング: 軽量イベント（`IntransitiveActivity` + hint）、TTL
  短め（サーバ保存しない or クライアント側で期限切れ破棄）。

---

# メディア添付（暗号化ファイル）

- AS2 `Document`/`Image` などを **暗号化 BLOB** として送る。
- 推奨構造（Matrix の `EncryptedFile` に類似のフィールドセットを AS2
  拡張で定義）:

  - `url`: BLOB ストレージの URL（CDN 可）
  - `key`: コンテンツ鍵（AES-GCM or XChaCha20-Poly1305）
  - `iv`/`nonce`, `hashes`（sha256）, `v`（スキーマバージョン）
- BLOB はサーバが配信可能だが本文は暗号のまま。メタは最小化。 （グループ本文は
  MLS、添付のペイロードはコンテンツ暗号で二層にするのが実用的）

---

# デバイスと鍵管理

- 自デバイス: OS のセキュアストレージ利用。バックアップは
  **ユーザ管理パスフレーズで暗号化**。([SWICG][1])
- 相手デバイスの取得: Actor の `keyPackages` コレクション（キャッシュ &
  期限管理）。([SWICG][1])
- 検証: デバイス指紋の表示 & QR/SAS で相互確認（推奨）。
- ローテーション: しきい値未満になったら相手に新 KeyPackage の公開を促す。
- 新デバイス追加: 自分を `Add` して自デバイスにも Welcome を配る運用が安全。

---

# フェデレーション上の注意

- **宛先は必ず Actor を列挙**。followers コレクションや `as:Public`
  に送らない（MLS のグループ管理要件）。([SWICG][1])
- 各 Actor の `keyPackages` は AP プロファイルの拡張プロパティ（`Collection`
  として公開）。([SWICG][1])
- サーバは「配送サービス」として動き、本文は **`message/mls`**
  のバイナリを保持・転送のみ。([SWICG][1])

---

# メタデータ漏えいと対策

- サーバには宛先・送信者・送信頻度などが見える。対策として：

  - 宛先パディング（ダミー宛先は非推奨だが、`IntransitiveActivity`
    によるノイズ送信は可）。([SWICG][1])
  - メッセージバッチング/送信間隔のランダム化（任意）。
  - ルーム名/アイコンは **暗号化アプリデータ**
    としてのみ保持（サーバ平文保存しない）。

---

# エラーハンドリング

- 招待先に `keyPackages` が無い → 「E2EE 未対応」エラーを UI
  表示し、参加不可（非暗号モードに落とさない）。([SWICG][1])
- 復号失敗 → イベントをプレースホルダ表示（再試行 or キー再要求）。
- 参加者除外後の古いメッセージ → 既設デバイスは復号可、新参加者は不可（MLS
  の性質）。([SWICG][1])

---

# クライアント実装メモ

- ストレージ（例）

  - `rooms(id, metadata, mls_state)`
  - `room_members(room_id, actor, devices)`
  - `events(event_id, room_id, type, relates_to, ciphertext, plaintext_cache?)`
  - `receipts(room_id, actor, last_read_event_id)`
  - `attachments(event_id, url, key, iv, hashes, v)`

- 同期

  - `inbox` のポーリング/ストリーミング（サーバ実装に合わせて）。
  - ページングは AP の通常ページング。クライアントはローカルに復号キャッシュ。

- 互換

  - Matrix の UX を参考にするが、暗号方式は MLS（Olm/Megolm
    ではない）。([matrix.org][3], [GitLab][4])

---

# 暗号スイート（推奨初期値）

- MLS 1.0 互換の既定スイートを 1 つ選定（実装依存）。
- 署名鍵はデバイスごと。鍵保管はセキュアストレージ、バックアップはパスワード暗号。([SWICG][1])

---

# 将来拡張

- ルーム用の共有プロフィール（名前・アイコン・トピック）をアプリデータで標準化。
- メッセージ検索（ローカル索引／サーバサイドは不可）。
- ルーム招待リンク（招待トークン + 一時 KeyPackage 生成）。
- 端末クロスサイニング/信頼モデルの仕様化。
- 伝送量削減のためのメディアサムネイル暗号標準化。

---

## 参考（抜粋）

- **MLS over ActivityPub**: AP を配送、MLS
  を暗号層として重ねる公式ドラフト。`PrivateMessage`/`Welcome` 等の型と
  `message/mls` 埋め込み、`keyPackages` 発行の方法が書かれている。([SWICG][1])
- **E2EE 統合モデル**: 実装レベルの選択肢とトレードオフ。([SWICG][2])

[1]: https://swicg.github.io/activitypub-e2ee/mls.html
[2]: https://swicg.github.io/activitypub-e2ee/integration-models.html
[3]: https://matrix.org/docs/spec/
[4]: https://gitlab.matrix.org/
