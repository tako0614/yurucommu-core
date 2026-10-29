# 標準のWeb Pushの送信

yurucommu-coreのinstanceが、ブラウザ・ホーム画面のweb app・ブラウザのようなクライアント（Takosumi Mobile）へ、
標準のWeb Pushを自分で送る仕組みです。全体の設計と判断理由はtakos-controlの
`docs/platform/takosumi-mobile-browser.md` とADR 0026にあります。この文書はこのrepoの実装の説明です。

## 登録

既存の `POST /api/notifications/pushers` に `kind: "webpush"` を足しています。項目の並びはMatrixのMSC4174と同じです。

```json
{
  "product": "yurucommu",
  "pusher": {
    "kind": "webpush",
    "app_id": "jp.takos.yurucommu.web",
    "pushkey": "<subscriptionのp256dh（base64url）>",
    "lang": "ja",
    "data": { "url": "<subscriptionのendpoint>", "auth": "<subscriptionのauth（base64url）>" }
  }
}
```

- `pushkey` は正規のbase64url（paddingなし）で、曲線上にある非圧縮のP-256の点でなければ400です。
- `data.url` はgateway URLと同じ規則で検査します（https、port 443、IPのliteral・`localhost`・`.local`・`.internal`・
  `.home`・`.lan`・1語のhostを拒否）。gatewayのhost allowlistは適用しません。push serviceはどこでもよいためです。
  開発用に、`YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK` があるときだけ `http://127.0.0.1` などを受け付けます。
- 保存するのは `pushkey`（p256dh）、`gateway_url` 列にendpoint、`data_json` に `{auth}` だけです。応答に `auth` は返しません。
- 登録を確かめる手順（MSC4174のactivation）はありません。schemaの変更もありません（`kind` 列は既存）。
- 削除は既存の `DELETE /api/notifications/pushers` に `app_id` と `pushkey`（p256dh）を渡します。

## VAPIDの鍵

- `ENCRYPTION_KEY`（32byteの16進）から、HKDF-SHA256（salt空、info = `yurucommu/web-push/vapid/v1` || 0x00 || counter）で
  32byteを導き、1 ≦ d < nになるまでcounterを進めます（rejection sampling）。保存も新しいsecretの枠もありません。
- 公開鍵は `GET /api/notifications/pushers/config` の `web_push_public_key` で返します。以前の手入力の
  `YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY` は無視します。`ENCRYPTION_KEY` が無いか不正なら `null` で、
  `webpush` の登録は400になります。
- 鍵を替えるときはlabelの版を上げます。browser SDK（`@takosjp/yurucommu-api`）は、同じserverで有効にした購読の
  公開鍵が変わったことに気づくと、購読し直して登録し直します。

## 送信

`processNotificationPushJob` が、`http` のpusherは従来どおりgatewayへ、`webpush` のpusherは1件ずつ
`src/backend/lib/web-push/` の `sendWebPush` で送ります。

- 暗号化はRFC 8291（aes128gcm、record size 4096、1 record）。RFC 8291 付録Aのtest vectorで確かめています。
- `Authorization: vapid t=<ES256 JWT>, k=<公開鍵>`。`aud` はendpointのorigin、`exp` は12時間後、`sub` は `APP_URL` の
  origin。同じ鍵・aud・subのJWTは、残りが1時間を切るまで使い回します。
- `TTL` は172800秒、`Urgency` はDMとトークが `high`、それ以外は `normal`。DMは会話ごとの `Topic`
  （会話IDのSHA-256の先頭24byteのbase64url、32文字）を付けます。redirectは追いません（`redirect: "manual"`）。
- 応答の扱い:

  | 応答 | 扱い |
  | --- | --- |
  | 2xx | 届いた |
  | 404・410 | pusherを消す |
  | timeout・通信の失敗・408・429・5xx | 後で送り直す（`Retry-After` に従う、最大12時間） |
  | 3xx・その他の4xx（401・403・413を含む） | jobの `last_error` に残す。送り直さず、pusherも消さない |

  403で消さないのは、instance側の署名の不具合で全員の購読が一度に消えるのを避けるためです。

## 中身（Declarative Web Push）

```json
{
  "web_push": 8030,
  "notification": {
    "title": "Yurucommu",
    "body": "さくらさんがあなたをフォローしました",
    "navigate": "https://yurucommu.example/notifications",
    "lang": "ja",
    "tag": "notifications",
    "app_badge": "3"
  }
}
```

- `title` はproductの名前（yurucommu → Yurucommu、yurume → Yurumeet）、`navigate` は `APP_URL` と同じoriginに限ります
  （yurucommuは `/notifications`、yurumeは `/`）。
- `body` は送り手の表示名と種類だけで、投稿やメッセージの本文は入れません。言語はpusherの `lang` が `ja` で始まれば
  日本語、それ以外は英語、無ければ日本語です。
- `app_badge` はproductごとの未読数（既存のbadgeと同じ計算）、`tag` はyurucommuが `notifications`、DMが `dm-<topic>`、
  トークが `talk` です。
- 平文は2,048 byte以下に収めます（超えたら本文を、次に題名を詰める）。

各アプリのService Worker（`public/notification-push-sw.js`）は、この形を表示し、`navigate` が別のoriginなら
アプリの既定のページを開きます。
