# FCM 設定

Takos では Firebase Cloud Messaging
を利用して通知を配信できます。クライアントには Firebase
の設定情報を埋め込まず、サーバーから `/api/fcm/config` 経由で取得します。

## 必要な環境変数

`app/api/.env` に以下の値を設定してください。

- `FIREBASE_SERVICE_ACCOUNT` – Firebase サービスアカウント JSON
- `FIREBASE_CLIENT_CONFIG` – `google-services.json` 相当のクライアント設定
- `FIREBASE_VAPID_KEY` – Web Push 用の公開 VAPID キー

## トークン登録

クライアントは取得した FCM トークンを `/api/fcm/token` へ POST
することで、サーバーからプッシュ通知を受け取れるようになります。
