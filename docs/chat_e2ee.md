# ActivityPub + E2EE チャット実装メモ

## 宛先設定

- `to`/`cc` にはルームの全メンバー Actor URL を列挙する。
- `followers` や `as:Public` は使用しない。
- 宛先漏れがあると MLS のグループ整合性が崩れる。

## メッセージ配送

- AP `Create` を自分の `outbox` に送る。
- `object` は `type: ["Object","PrivateMessage"]`, `mediaType: "message/mls"`,
  `encoding: "base64"` を含む。`@context` には
  `https://www.w3.org/ns/activitystreams` と
  `https://purl.archive.org/socialweb/mls` を併記する。
- `content` に MLS PrivateMessage の Base64 を入れる。
- グループ状態を変える MLS の `Proposal` や `Commit` などは
  `type: ["Object","PublicMessage"]` として同様に配送する。ここでの `Public`
  は「公開」ではなく、暗号化されないハンドシェイクメッセージを
  指す。宛先は通常どおり全メンバーを列挙する。

## 鍵とデバイス管理

- 各 Actor の `keyPackages` コレクションからデバイス公開鍵を取得してキャッシュ。
- 新メンバー追加時は `Welcome` を当該 Actor のみに送る。

## メタデータ漏えい

- サーバは宛先・送信者・送信時刻を把握できる。
- ノイズメッセージや送信間隔のランダム化で緩和可能。

## エラー処理

- 招待先に `keyPackages` が無い場合は「E2EE 未対応」エラーを表示。
- 復号失敗時は再試行またはキー再取得を促す。
