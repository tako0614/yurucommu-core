# チャット機能まとめ

Takos で検討しているチャット機能の概要をまとめる。

- プロトコル面の注意点は [chat_e2ee.md](./chat_e2ee.md) を参照。
- UX とドメインモデルは [chat_ux.md](./chat_ux.md) を参照。

## 要点

- ルームは明示的なメンバー制で、`to`/`cc` に全メンバーを列挙する。
- メッセージ本文は MLS で暗号化し、ActivityPub `Create` の `PrivateMessage`
  として配送する。
- MLS の `Proposal` や `Commit` などのハンドシェイクは `PublicMessage`
  オブジェクトで配送するが、公開投稿を意味しない。
- 招待・追加・退出などの操作は MLS の `Add`/`Remove`/`Welcome` を用いて行う。
- サーバは配送のみを担い、メタデータ漏えいへの対策を検討する。

## ハンドシェイクメッセージ

MLS の `Proposal` や `Commit` などのハンドシェイクは暗号化せず `PublicMessage`
として送受信する。これらは公開投稿ではなく、ハンドシェイク専用のメッセージである。\
サーバーではハンドシェイクを `HandshakeMessage` コレクションに保存し、API
`/users/:user/handshakes` で取得・送信する。\
通常のメッセージ一覧 `/users/:user/messages` には暗号化された `PrivateMessage`
のみが含まれ、`PublicMessage` は含まれない。
