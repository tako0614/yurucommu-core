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
  `.home`・`.lan`・1語のhost・空のlabelを拒否）。末尾の点（`localhost.`、`metadata.google.internal.`、`intranet.`）は
  点の無い名前と同じDNS名なので、空のlabelとして拒否します。gatewayのhost allowlistは適用しません。push serviceは
  どこでもよいためです。開発用に、`YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK` があるときだけ
  `http://127.0.0.1` などを受け付けます。同じ規則のSDK側の写しは、共有のfixture（`gateway-url-fixtures.ts`）で揃えています。
- 保存するのは `pushkey`（p256dh）、`gateway_url` 列にendpoint、`data_json` に `{auth, session}` です。`session` は登録した
  requestのsession（cookieまたはBearer）の保存鍵（`sessions.id`）で、server内だけで使います。応答に `auth` も `session` も
  返しません。sessionの資格情報が無いrequestからの `webpush` の登録は401です。
- 同じ `(product, app_id, p256dh)` の行が別のアカウントにあるとき、行を移せるのは同じendpointと同じ `auth` を示したとき
  だけです（同じbrowserで別のアカウントにsign inした場合）。p256dhだけを合わせた登録は409で、元の行は変わりません。
  p256dhはnative appのdevice tokenのような秘密ではないため、これが無いと他人の購読を自分の行に書き換えて止められます。
  判定は事前のSELECTとupsertの `setWhere` の両方で行い、同時の登録でもすり抜けません。unique indexは変えていません。
- 登録を確かめる手順（MSC4174のactivation）はありません。schemaの変更もありません（`kind` 列は既存）。
- 削除は既存の `DELETE /api/notifications/pushers` に `app_id` と `pushkey`（p256dh）を渡します。

### sessionとの結び付き

通知の本文には送り手の表示名が入り、lock screenに出ます。sign outしたdeviceへ届け続けないよう、`webpush` の行は
登録したsessionに結び付けます。

- 送るたびに、そのsessionが同じアカウントのものとして存在し、期限内かを確かめます。無ければ送らずに行を消します。
  logout・login時のsessionの入れ替え・失効・期限切れ・アカウントの削除のどれでも、個別のhookなしに止まります。
  `session` を持たない行も止めます（今回の登録は必ず持ちます）。
- `POST /api/auth/logout` は、そのsessionが登録した `webpush` の行をその場で消します（best effort。消せなくても送信時の
  確認で止まる）。
- browserの購読は、使っているsessionでアプリを開くたびにSDKが登録し直すので、新しいsessionに結び付け直されます。
- 既存の、`last_seen_at` が90日より古いpusherを消す掃除はそのまま働きます。

## VAPIDの鍵

- `ENCRYPTION_KEY`（32byteの16進）から、HKDF-SHA256（salt空、info = `yurucommu/web-push/vapid/v1` || 0x00 || counter）で
  32byteを導き、1 ≦ d < nになるまでcounterを進めます（rejection sampling）。保存も新しいsecretの枠もありません。
- 公開鍵は `GET /api/notifications/pushers/config` の **`web_push_instance_public_key`** で返します。`ENCRYPTION_KEY` が
  無いか不正なら `null` で、`webpush` の登録は400になります。以前の手入力の
  `YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY` は無視します。
- gateway時代の `web_push_public_key` は応答に残し、常に `null` を返します。4.1.x以前のSDKはこの値と購読の鍵を比べ、
  違えばserverの行を消してunsubscribeします。この欄にinstanceの鍵を入れると、開いたままのタブや古いcacheの
  4.1.xのSDKが、新しいSDKが作った購読を消してしまい、新しいSDKは（記録が消えたので）購読し直しません。`null` なら
  古いSDKは「unconfigured」になり何も消しません。古いSDKが作った `http` の行は、gatewayの設定が残っていれば
  新しいSDKが移すまでgateway経由で届きます。gateway時代の値を返さないのは、新旧のタブが1つの購読を
  奪い合わないようにするためです。
- browser SDK（`@takosjp/yurucommu-api` 4.2.0以降）は `web_push_instance_public_key` だけを使います。
  `fetchNotificationPusherPublicConfig()` は両方の欄を返し、`enabled` はinstanceの鍵があるときだけ `true` です。
  `createBrowserPushConfigResolver().resolveConfig()` は、/configを取れないとき `null` を返します。build時の値
  （`buildTimeValues`）は無視し、`buildTimeConfig()` は常に `null` です。build時に埋め込んだ鍵はgateway時代の鍵で、
  それで比べると動いている購読を取り消してしまうためです。
- 鍵を替えるときはlabelの版を上げます。browser SDKは、同じserverで有効にした購読の公開鍵が変わったことに気づくと、
  購読し直して登録し直します。

## 送信

`processNotificationPushJob` が、`http` のpusherは従来どおりgatewayへ、`webpush` のpusherは1件ずつ
`src/backend/lib/web-push/` の `sendWebPush` で送ります。

- 暗号化はRFC 8291（aes128gcm、record size 4096、1 record）。RFC 8291 付録Aのtest vectorで確かめています。
- `Authorization: vapid t=<ES256 JWT>, k=<公開鍵>`。`aud` はendpointのorigin、`exp` は12時間後、`sub` は `APP_URL` の
  origin。同じ鍵・aud・subのJWTは、残りが1時間を切るまで使い回します。
- `TTL` は172800秒、`Urgency` はDMとトークが `high`、それ以外は `normal`。redirectは追いません（`redirect: "manual"`）。
- DMには受け手ごと・会話ごとの `Topic` を付けます。`Topic` は暗号化されずにpush serviceへ届き、中継はAPNsの
  collapse idやFCMのcollapse keyに使うので、外から計算できない値にします。鍵 = HKDF-SHA256（IKM = `ENCRYPTION_KEY`、
  salt空、info = `yurucommu/web-push/topic/v1`）の32byte、`Topic` = HMAC-SHA256（鍵、受け手のactor IDのbyte長
  （uint32 big-endian）‖ 受け手のactor ID ‖ 会話ID）の先頭24byteのbase64url（32文字）。会話IDは2人の公開されたactor IDから
  決まるため、平文のhashだと誰と誰がDMしているかを総当たりで知られ、2人のdeviceも同じ値で結び付きます。
  鍵が無ければ `Topic` は付けません（送信自体もできません）。
- endpointは送信のたびに静的な規則で検査し直します。Bun・Node（self-host）では、さらにhost resolverでhost名を引き、
  privateなどpublicでないaddressが1つでもあれば送りません（`assertSafeRemoteUrlResolved`。`127.0.0.1.nip.io` のような
  名前を止める）。引けない・時間切れなら後で送り直し、publicでない答えはjobの `last_error` に残して送り直しません。
  Cloudflare Workersにはfetchと比べるhost resolverが無く、Workersのfetchはprivateなaddressへつながらないので、この
  確認は省きます。確認したaddressへ接続を固定はしていません（federationと同じ。確認と接続の間にrecordが変わる余地は残る）。
  `last_error` やlogにendpointのURL（pathがdeviceのpush token）は入れません。
- 応答の扱い:

  | 応答 | 扱い |
  | --- | --- |
  | 2xx | 届いた |
  | 404・410 | pusherを消す |
  | timeout・通信の失敗・408・429・5xx | 後で送り直す（`Retry-After` に従う、最大12時間） |
  | 3xx・その他の4xx（401・403・413を含む） | jobの `last_error` に残す。送り直さず、pusherも消さない |

  403で消さないのは、instance側の署名の不具合で全員の購読が一度に消えるのを避けるためです。
- 1件のpusherを扱う途中で例外が起きても、そのpusherだけを送り直します（gatewayの束も同じ）。lease更新などjob全体の
  処理で例外が起きたときも、すでに答えが出たpusher（届いた・消した・失敗が確定した）は送り直しの対象から外します。
  同じ通知が2度届かないようにするためです。

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
