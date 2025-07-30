以下は **「一覧（リール）／作成（エディタ）／表示（プレイヤー）」** を最短で作るための指針と要点です。
Takos（SolidJS 前提）想定ですが、React/Vue でも同じ構成でいけます。

---

## 1) UX要件（まずここを固定）

* **一覧（リール）**

  * 丸いアバター + リング（未読=カラー、既読=グレー）
  * 並び順：フォロー中の最新 `published` 降順。自分→相互→その他の順にブースト可
  * 既読管理：`Story.id` ごとの lastSeen をローカルに保持
* **プレイヤー**

  * 9:16 全画面（縦モバイル想定。デスクトップは 360×640 のモーダル）
  * タップ右=次フレーム、左=前フレーム／長押し=一時停止／上スワイプ=リンク／下スワイプ=クローズ
  * 上部に複数バー（フレーム進行）。自動進行（画像: 5s 目安、動画: duration）
  * 音量トグル・ミュートを常時表示
* **作成（エディタ）**

  * 取り込み：カメラ or ギャラリー
  * トリミング：9:16 固定（パン＆ズーム）
  * オーバレイ：Text / Mention / Hashtag / Link（移動・拡大縮小・回転）
  * 受け手選択：Followers / Close Friends / DM（`to/cc/bto/bcc`）
  * 24h 期限（`expiresAt` 自動 24h 後）＋ハイライトへ保存（任意）

---

## 2) コンポーネント分割（SolidJS 例）

* `StoryReel`：一覧（水平スクロール）
* `StoryAvatar`：アバター＋リング＋未読ドット
* `StoryViewer`：全画面/モーダルのプレイヤー（状態機械式）
* `StoryFrame`：単一フレーム（Image/Video + Overlays）
* `StoryEditor`：作成エディタ（メディア取り込み～投稿）
* `OverlayCanvas`：<svg> でオーバレイ描画・編集
* `useStories()`：取得・既読・プリフェッチのフック
* `useStoryPlayer()`：再生制御（タイマー、ジェスチャ、プログレス）

**状態機械（簡略）**

```
Idle -> Opening -> Playing <-> Paused -> Dismissed
events: TAP_LEFT/RIGHT, HOLD, RELEASE, SWIPE_UP/DOWN, MEDIA_END, CLOSE
```

---

## 3) データ契約（フロント⇔サーバ）

* **一覧** `GET /users/:name/stories`

  * `OrderedCollection { orderedItems: Story[] }`
  * `Story.items: StoryItem[]`（最初の1枚でサムネ）
* **作成** `POST /ap/users/:name/outbox/story`

  * `Create{Story}` を投げる（`expiresAt`無ければサーバで +24h）
* **既読**（ローカル集計推奨）

  * `POST /ap/local/story-view { story: IRI, at: ISO }`（連合はしない）

---

## 4) プレイヤー実装の要点

* **メディア**

  * 画像：`<img>`。表示直前に `decode()` 呼ぶ
  * 動画：モバイル安定なら MP4/H.264。長尺や分割は HLS（Safari ネイティブ、他は hls.js）
  * **プリロード**：現在の前後 1 フレームを先読み。次のユーザの 1 フレームも余力があれば
* **タイマー**

  * `requestAnimationFrame` ベースで残り時間を更新（`setInterval` は誤差が出やすい）
  * 長押しで **一時停止**（動画 `pause()`、画像はタイマー停止）
* **オーバレイ**

  * `<svg viewBox="0 0 1000 1000">` を土台に、`x,y,w,h` を比率→座標変換
  * Text は `<foreignObject>` + CSS か `<text>`、Mention/Hashtag はクリックで詳細へ
* **操作と退出**

  * クリック領域（左右 30–35%）を分けて前後移動
  * 上スワイプで `Link` があれば開く
  * 下スワイプ or ESC で閉じる、背景クリックは無効化（誤操作防止）
* **エラー/フォールバック**

  * 動画ロード失敗→`fallback` 画像へ即切替
  * メディア失効後は UI から消す（`expiresAt` を常時チェック）

---

## 5) 作成エディタの要点

* **入力→キャンバス**

  * 画像/動画を 9:16 にフィット（cover/pan で crop 可能）
  * Web 動画は最大 15s/フレーム推奨（長い場合は分割 or トリム UI）
* **オーバレイ編集**

  * バウンディングボックス（ドラッグ/ピンチ/回転ハンドル）
  * フォントサイズ・色・スタイル（`style` を key-value として保存）
* **アクセシビリティ**

  * `alt` 入力を必須化（音声読み上げ用）
  * カラーコントラスト自動チェック（警告を出す）
* **投稿フロー**

  * 先にメディアをアップロード→URL 受領→`Create{Story}` 組み立てて送信
  * `fallback` 画像は最初のフレームの縮小版をサーバ側で生成
* **可視範囲**

  * 受け手選択（Followers / Close Friends / DM）を明示
  * 期限（24h）は固定。ハイライトに保存で恒久化

---

## 6) パフォーマンス指針

* 画像は `loading="eager"`（最初の1枚）、以降は先読みキューで管理
* 動画は `preload="metadata"`、再生直前で `auto`。終了直前に次を `play()` 準備
* 使い終えた Blob/URL は即 `revokeObjectURL`、動画 `srcObject` を `null` に
* アニメーションは transform/opacity のみ（GPU 合成）
* メモリ：同時に保持するフレームは「現在 + 前後 1」まで

---

## 7) アクセシビリティ & 国際化

* キーボード：`←/→` 前後、`Space` 一時停止、`Esc` 閉じる
* `prefers-reduced-motion` で自動進行を遅く/停止するオプション
* 代替テキスト必須／字幕（動画の `track`）対応
* CJK/RTL の折り返しとフォントフォールバックをテスト

---

## 8) セキュリティ/プライバシー

* `expiresAt` を UI 側でも強制（失効後は一覧に出さない・プレイヤーで閉じる）
* **bto/bcc**（Close Friends/DM）はシェア UI を隠す・スクショ注意のトグル表示（技術的防止は不可能）
* リンクは `rel="noopener noreferrer"`／同ドメイン以外は遷移前確認

---

## 9) テレメトリ（ローカル集計）

* `view`（開始）、`complete`（最後まで視聴）、`exit`（中断）、`tap_next/prev`、`swipe_up` など
* 1ユーザ1ストーリーにつき重複カウント抑制（一定時間でデバウンス）

---

## 10) エッジケースとQAチェック

* ネット遅延（3G）・パケロス時：タイムアウト→次フレームにスキップ
* 動画の無音/音あり切替、ミュート初期化（ブラウザの自動再生ポリシー対策）
* 端末回転（orientation change）でキャンバス再レイアウト
* 期限直前に開いた場合：視聴中に失効→次のストーリーへフェールオーバー
* 外部サーバのメディア 403/410：即フォールバック

---

## 11) 最小 MVP の実装順（おすすめ）

1. **StoryReel**：サムネとリングだけ（未読管理含む）
2. **StoryViewer**：画像フレームの自動進行・左右タップ
3. **Video 対応**：duration/ミュート/自動再生
4. **Overlays 表示**（読み取り専用）
5. **Editor（画像のみ）** → その後動画・オーバレイ編集へ拡張

---

## 12) 参考インターフェース（ごく小さな雛形）

```ts
// フレーム進行（画像5s / 動画はduration）
function nextFrame(state) {
  const items = state.story.items;
  const i = state.index + 1;
  if (i < items.length) return { ...state, index: i, t0: performance.now() };
  return "NEXT_STORY";
}
```

---

必要なら、この指針を **実装チェックリスト**と\*\*UIコンポーネント雛形（SolidJS）\*\*に展開して、そのままリポジトリに置ける形で出します。
「MVP からやる順」に落とし込んだタスク群も用意できますが、どこから着手しますか？（例：まずリール→画像プレイヤー）
