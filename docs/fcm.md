# FCM 設定

Takos では Firebase Cloud Messaging
を利用して通知を配信できます。クライアントには Firebase
の設定情報を埋め込まず、サーバーから `/api/fcm/config` 経由で取得します。

## 必要な環境変数

`app/api/.env` または takos host を利用する場合は `app/takos_host/.env` に
以下の値を設定してください。

- `FIREBASE_SERVICE_ACCOUNT` – Firebase サービスアカウント JSON
- `FIREBASE_CLIENT_CONFIG` – `google-services.json` 相当のクライアント設定
- `FIREBASE_VAPID_KEY` – Web Push 用の公開 VAPID キー

takos host ではホスト側で設定した値が各テナントへ自動的に引き継がれます。

## トークン登録

クライアントは取得した FCM トークンを `/api/fcm/token` へ POST
することで、サーバーからプッシュ通知を受け取れるようになります。

## Tauri アプリでの利用

Tauri 版では `tauri-plugin-push-notifications` を組み込み、 Android では Kotlin
製サービスで FCM を初期化します。 `google-services.json` を `src-tauri/android`
に配置し、 ビルド時に自動で読み込まれます。デスクトップ向け (Windows) でも
同プラグインが利用されます。
