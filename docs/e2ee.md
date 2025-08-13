いいね、その前提なら「部屋（トークルーム）＝MLSグループ」「ユーザー＝ActivityPub Actor」「端末＝MLSクライアント」で設計すると現実的に回ります。以下“最小で実用的”な仕様案👇

# 仕様のゴール

* トークルーム単位で開始・参加
* 同じActorの**どの端末でも**、その端末が部屋に参加した瞬間から**送受信OK**
* ActivityPub配送＋MLS暗号化（`message/mls`）で相互運用できること。([Swicg][1])

# モデル

* **Actor（ユーザー）**：公開プロフィールに `keyPackages` コレクションを持つ（ここに端末ごとのKeyPackageを並べる／`generator`でクライアント識別可）。([Swicg][1])
* **端末（クライアント）**：MLSのメンバー単位。**KeyPackageは基本ワンタイム**で、必要なら複数スイート分を公開。([IETF Datatracker][2])
* **部屋（トークルーム）**：クライアント側の概念＝MLSグループIDで表現。ActivityPub配送では**参加者Actorを明示アドレス指定**し、コレクション宛てやPublic宛ては不可。([Swicg][1])

# 端末と鍵のライフサイクル

1. **端末ログイン/初期化**
   端末は署名鍵を生成→KeyPackageをN個生成→Actorの `keyPackages` にCreate/Add。**認証は「そのKeyPackageがActorの`keyPackages`に入っているか」で確認**。([Swicg][1])
2. **端末の無効化/消去**
   使い終えたKeyPackageはRemove/Deleteし、差し替え攻撃対策として**指紋確認（fingerprint verification）を推奨**。([Swicg][1])

# ルーム作成〜招待（最初の参加）

* 作成端末は、参加者ごとに**互換スイートのKeyPackageを少数（推奨2–3個）選択**して**同一CommitでまとめてAdd**。
  **Welcomeは1通に複数受信者分の`EncryptedGroupSecrets`を同梱**してOK（または複数通に分割）。**同梱の集合は、そのCommitで追加した“全新規メンバー”をカバー**すること。([IETF Datatracker][2])
* 配送は `Create { object: PrivateMessage | Welcome, mediaType: "message/mls" }` を**各Actorの`inbox`へ直接**。APは**明示アドレスのみ**、ポーリング取得。([Swicg][1])
* **ACK運用**：招待が復号されたら、参加端末は最初のPrivateMessageで「JoinAck」をアプリレベルで返す（復号失敗・未達時はタイムアウト後に**別KeyPackageで自動再招待**）。

# “どの端末でも参加したら即送受信OK”を担保する仕組み

* **ブートストラップ＋自動追加入室**
  あるActorの**1端末でも入れたら、その端末が同Actorの他端末を自動でAdd**（相手Actorの`keyPackages`を見に行き、互換KeyPackageを選択→Commit→Welcome）。これで**同一ユーザーの新端末は、参加後すぐ送受信可**になる。([Swicg][1])
* **新端末検知のトリガ**

  * 自分（同Actor）の`keyPackages`に新規KeyPackageが出たら、既存参加端末が**所属する全ルームに対してAdd**を順次実行。
  * 端末台数が多いActorでも、**最初は2–3端末だけ招待→ACKが来たら残りを順次**にするとKeyPackage在庫枯渇や“空席メンバー”膨張を抑制できる。
* **送信要求時のオンデマンド追加**
  未参加の自分端末がルームで送信しようとしたら、クライアントは**裏で自分の参加端末に“自分をAddして”リクエスト**（AP上は同Actor宛の暗号化メッセージ）→Add/Welcome完了後に再送。

# KeyPackage選択アルゴ（実装簡略版）

1. 参加者Actorの `keyPackages` を取得
2. グループのMLS **version/cipher\_suiteと合う**ものだけにフィルタ
3. \*\*新しい順に上限M（推奨2–3）\*\*選択（同一`generator`が並ぶ場合は最新のみ）
4. Commitにまとめ、**Welcomeは1通で同梱**（実装で分割も可）
5. **ACKが無いKeyPackageは別の候補で再招待**（回数/時間上限あり）
   — KeyPackageは**原則ワンタイム**なので、消費した分は相手側で補充される前提。([IETF Datatracker][2])

# エラーハンドリング & 掃除

* **空席メンバー（参加しない端末）**
  一定時間ACKなし→アプリポリシーでRemove。MLSはツリーが対数コストで伸縮するので、運用で十分捌ける。([IETF Datatracker][2])
* **鍵差し替えリスク**
  `keyPackages`はサーバ管理の公開コレクションのため**置換攻撃に注意**。**端末指紋の比較UI**や、既知端末のみ自動追加などのスコープ制限を推奨。([Swicg][1])
* **再入室**
  端末再インストール等には**Resumption PSK**（再開用PSK）で状態リンクや再招待の簡略化を検討。([IETF Datatracker][2])

# なぜこの設計が“実用的”か

* **配送の現実性**：APは**受信者Actorを明示**＋**`inbox`ポーリング**前提。MLSオブジェクトの封筒は `message/mls` に載せる設計がドラフトで明示済み。([Swicg][1])
* **初回UX**：**少数まとめAdd＋1通Welcome**で“どの端末でも”成功率を上げつつ、ACK再招待で取りこぼしを回収。**Welcomeは複数新規メンバーを1度にカバー可能**。([IETF Datatracker][2])
* **拡張性**：KeyPackageは**スイートごと**＆**ワンタイム**運用が標準化されているので、将来の暗号スイート移行も容易。([IETF Datatracker][2])

---

必要なら、この仕様をもとに「Create/Welcome/PrivateMessage」のJSON雛形や、ACK再招待の擬似コードも書き起こします。

[1]: https://swicg.github.io/activitypub-e2ee/mls "Messaging Layer Security over ActivityPub"
[2]: https://datatracker.ietf.org/doc/html/rfc9420 "
            
                RFC 9420 - The Messaging Layer Security (MLS) Protocol
            
        "
