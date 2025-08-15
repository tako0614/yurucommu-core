# 目的

- トークルーム（=
  MLSグループ）に**招待された側の“どの端末でも”**、初回起動だけで**即座に送受信を開始**できること
- 端末を特定して事前に起動させる必要がないこと（“選ばれた端末を起動してからでないと始まらない”問題の解消）
- **グループ作成者（招待送信者）の“他のアクティブ端末”も同時に参加**できること（コミットを実行した端末自身はWelcome不要）

# 前提・用語（抜粋）

- **message/mls** を ActivityPub の `Object.mediaType`
  に使い、MLSバイナリをBase64で封入する。([SWICG][1])
- MLSオブジェクトは **PublicMessage / PrivateMessage / Welcome / GroupInfo /
  KeyPackage** を扱う。([SWICG][1])
- 配送は **Actor宛に明示指定**（コレクション宛・`as:Public`禁止）、受信は
  `inbox` を**ポーリング**。([SWICG][1])
- 各Actorはプロフィールに **`keyPackages`
  コレクション**を持つ（KeyPackageのCreate/Add/Remove/Deleteのライフサイクルを運用）。`generator`でクライアント識別も可能。([SWICG][1])
- MLSの状態（ラチェットツリーなど）はサーバーに保存せず、クライアントが
  IndexedDB などのローカルストレージに保持する。
- MLS に関する暗号化・復号・検証はすべてクライアント側で行い、サーバーは
  暗号化済みデータの保存と配送だけを担う。
- トークルームの名前とアイコンは MLS `GroupContext`
  の拡張に格納し、メンバー全員で共有する（変更には Commit が必要）。
- チャットルームの一覧は暗号化メッセージから推測でき、`chatrooms`
  コレクションがなくてもトークを表示できる。メタデータを保持したい場合のみ
  `chatrooms` を用いる。
- **KeyPackageの公開は“アクティブなセッション”に限定**し、ログアウト・長期不使用・端末無効化時には当該セッションのKeyPackageを速やかに削除する（誤招待・空席抑止のため）。([SWICG][1])
- MLSは**グループあたり1つの暗号スイート**、KeyPackageには `version` /
  `cipher_suite` / `init_key` / `leaf_node` 等が入る。([IETF Datatracker][2])
- **KeyPackageは原則ワンタイム**（“ラストリゾート”のみ例外）。([IETF
  Datatracker][2])
- **Commitで1人以上を追加すると、対応する Welcome
  が1通以上**必要（1通に複数の新規メンバー分を入れても、各メンバーごとに分けてもOK）。([IETF
  Datatracker][3])

---

# 仕様概要（パターンA）

## 1) 招待（ルーム作成・既存ルームへの招待）

**送信側アルゴ（Actor単位）：**

1. 相手Actorの `keyPackages` コレクションを取得。**グループの MLS `version` /
   `cipher_suite` と一致**するKeyPackageだけにフィルタ。([IETF Datatracker][2])
2. 新しい順（または有効期限の長い順）に \*\*上限 M
   個（推奨3〜5）\*\*選択。`generator` が同じものは最新1個に丸める。([SWICG][1])
3. すべての招待対象Actorから選んだ
   KeyPackage（複数端末ぶん）に加え、**送信者自身の“アクティブ端末”のKeyPackage**（自Actorの
   `keyPackages` から選択、上限 M 適用）も同様に選定し、**1回のCommitにまとめて
   `Add`**。**`path`は省略可**（AddのみならRFC上“Path
   Required”ではない）。([IETF Datatracker][2])
4. **Welcomeの作成**（新規に `Add` された各メンバー端末向け）

   - 推奨：**Actorごとに1通ずつ**作る（そのActorの“新規メンバー端末”全員分の
     `EncryptedGroupSecrets`
     を同梱）。メタデータ相関を抑えたいなら**端末ごと1通**に分割。([IETF
     Datatracker][3])

- 自分自身のActor向けも、**コミットを実行した端末を除く他のアクティブ端末**に対してWelcomeを作成する（コミット端末は既にメンバーでWelcome不要）。

5. **配送**：各Welcomeを `Create` で**対象Actorの `inbox`
   へ明示宛先**で投函（`mediaType: "message/mls"`,
   `encoding: "base64"`）。([SWICG][1])

**ActivityPub 封筒（例：Welcome 1通/Actor）**

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://purl.archive.org/socialweb/mls"
  ],
  "type": "Create",
  "actor": "https://chat.example/u/alice",
  "to": ["https://remote.example/u/bob"], // 必ずActorを明示宛先
  "object": {
    "type": ["Object", "Welcome"],
    "id": "https://chat.example/u/alice/welcome/49",
    "mediaType": "message/mls", // RFC 9420登録メディアタイプ
    "encoding": "base64",
    "content": "[Base64-encoded Welcome]"
  }
}
```

（**注**：`message/mls`
はRFC登録済み。APオブジェクトにMLSバイナリをそのまま封入するのがドラフトの前提。宛先はコレクション不可。([IETF
Datatracker][2], [SWICG][1])）

## 2) 参加端末側の処理

- 受信した端末は `Welcome` を復号→**その端末が即メンバー化**→以後の
  `PrivateMessage` を送受信可能。([IETF Datatracker][3])
- **グループ作成（Commit）を実行した端末**は、その操作時点でメンバーであり**Welcomeは不要**。同一Actorの他端末はWelcomeで参加する。
- **ACK（JoinAck）**：最初の `PrivateMessage`
  でアプリ層ACKを返す（“入室成功”の検知用）。配送は同じく
  `message/mls`。([SWICG][1])

## 3) 失敗時の再招待・清掃

- **ACK待ちタイムアウト**（例：24h）。未ACKの“空席メンバー端末”は **Remove**
  してツリーを掃除、**別KeyPackageで再招待**。([IETF Datatracker][3])
- **KeyPackage消費**：ワンタイムなので、相手側は在庫を補充（古いKeyPackageの使い回しはNG）。([IETF
  Datatracker][2])
- **長期オフライン端末の整理**：一定期間鍵更新がない／復号実績がないメンバーはポリシーで除籍（RFCは**長期オフラインの追い出し**を推奨）。([IETF
  Datatracker][2])
- **自ActorのKeyPackage公開の衛生**：アクティブでないセッションのKeyPackageは公開しない／速やかに削除し、誤招待での“空席”を減らす。

---

# 選択ポリシー（最小で回る現実解）

- **フィルタ**：`version` / `cipher_suite` 一致のみ必須。([IETF Datatracker][2])
- **新しさ優先**：KeyPackageは**新しいほど安全**（古いもの追加は漏洩リスク上昇）。([IETF
  Datatracker][2])
- **上限 M**：Actorごと **M=3〜5**
  を目安（KeyPackage枯渇・“空席”増殖のバランス）。
- **重複抑止**：同一 `generator`
  は最新1個に集約（“同一アプリの複数在庫”での無駄打ち防止）。([SWICG][1])
- **自Actorの端末選定**：**アクティブなセッションのKeyPackageのみ**を対象にし、コミット端末は除外（Welcome不要）。

---

# メタデータ・セキュリティ配慮

- **宛先の明示**は必須（AP側仕様）。同じWelcomeを複数の宛先で1通にせず、**Actorごとに個別
  `Create`** すると相関が減る。([SWICG][1])
- **Key置換対策**：`keyPackages`
  はサーバ管理なので**置換攻撃に注意**（既知クライアントの`generator`確認や指紋UIなど）。([SWICG][1])
- **KeyPackage公開最小化**：公開対象をアクティブセッションに限定することで、招待メタデータからの端末活動状況の推測を抑制。

---

# 代表的なパラメータ（推奨初期値）

- `M`（Actorごとの同梱端末数）：**3**
- “長期オフライン”除籍閾値：**14〜30日**（運用に合わせ調整）。([IETF
  Datatracker][2])
- 自Actorの端末同梱上限（M_self）：**M
  と同一**でよい（運用で分けたい場合は別途設定）。

---

# 落とし穴と回避策

- **グループ膨張**：一度に多端末を足すほど“空席”が増える。→**ACK清掃を徹底**、次回以降はACK実績のある端末のみ積極招待。([IETF
  Datatracker][3])
- **スイート不一致**：グループ作成時にスイート固定（MLSは**グループあたり1スイート**）→取得時に一致チェック。([IETF
  Datatracker][2])
- **自端末の誤招待**：非アクティブセッションのKeyPackage公開を止める／削除する。アクティブ/非アクティブの同期に遅延があると“空席”に繋がるため、ログイン・ログアウト・端末無効化のイベントで即時反映する。

---

# 参考実装イメージ（疑似コード）

**KeyPackage選択**

```ts
const selectKeyPackages = (actorKP, groupSuite, M = 3) =>
  actorKP
    .filter((kp) => kp.version === "1.0" && kp.cipher_suite === groupSuite) // 必須
    .sort(byFreshnessDesc) // 新しい順
    .reduce(dedupByGeneratorLatest, []) // 同一generatorは最新1つ
    .slice(0, M);
```

**招待（Commit+Welcome作成→個別配送）**

```ts
for (const actor of invitees) {
  const kpList = selectKeyPackages(fetchKeyPackages(actor), group.suite);
  addProposals.push(...kpList.map((kp) => Add(kp)));
}
// 自Actorのアクティブ端末（コミット端末を除外）
const selfActor = me.actor;
const activeSelfKp = selectKeyPackages(
  fetchActiveKeyPackages(selfActor),
  group.suite,
);
addProposals.push(
  ...activeSelfKp
    .filter((kp) => kp.generator !== currentDeviceGenerator)
    .map((kp) => Add(kp)),
);

const { commit, welcomes } = mlsCommit(addProposals); // welcomes: joiner端末別に生成
for (const w of welcomesByActor(welcomes)) {
  postCreate(targetActorOf(w).inbox, wrapAsAPObject(w, "Welcome")); // message/mls, base64
}
```

---

**これで「どの端末でも起動した瞬間に読める」状態を“端末非依存”で実現**でき、かつ**自分のアクティブ端末も同時参加**させられます。
必要なら、ACK状態機械（再招待・Removeの条件）や、WelcomeをActor単位で1通にまとめる/分ける運用指針を、もう一段掘り下げて書き起こします。

**根拠**：AP封筒/`message/mls`/宛先ルールと`keyPackages`モデル（SWICGドラフト）、MLSのWelcome/KeyPackage/スイート/ワンタイム性/メディアタイプ登録（RFC
9420）。([SWICG][1], [IETF Datatracker][3])

---

## PSK と External Commit への対応

- ハンドシェイクおよびメッセージ送受信の各APIで `psks`
  フィールドを受け付け、事前共有鍵を MLS 処理に利用できるようになった。
- GroupInfo にラチェットツリーを含めて公開し、受け取った端末は
  `joinWithGroupInfo` を用いて External Commit を生成して参加できる。
