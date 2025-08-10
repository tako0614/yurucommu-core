# チャット機能まとめ

Takos で検討しているチャット機能の概要をまとめる。

- プロトコル面の注意点は [chat_e2ee.md](./chat_e2ee.md) を参照。
- UX とドメインモデルは [chat_ux.md](./chat_ux.md) を参照。

## 要点

- ルームは明示的なメンバー制で、`to`/`cc` に全メンバーを列挙する。
- メッセージ本文は MLS で暗号化し、ActivityPub `Create` の `PrivateMessage`
  として配送する。
- 招待・追加・退出などの操作は MLS の `Add`/`Remove`/`Welcome` を用いて行う。
- サーバは配送のみを担い、メタデータ漏えいへの対策を検討する。
