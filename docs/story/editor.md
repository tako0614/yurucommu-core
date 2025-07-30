### Webストーリーエディター ― 仕様指針（v1.0 ドラフト）

> **目的**
> ブラウザ上で “縦向きストーリー” を制作するエディターを定義する。
>
> * **テキスト・手描き（落書き）はビットマップに焼き込み**＝アップロード後は 1 枚の画像／動画フレームとして扱う。
> * **メンション／質問箱／位置情報など意味を伴う UI スタンプは焼き込まずに `x:overlays` として別送**。
> * すべての出力は前回提示した ActivityStreams オブジェクトにシリアライズできること。

---

## 1. 技術スタック

| レイヤ        | 推奨技術 / ライブラリ                                                                             | ノート                                       |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| 画像・動画編集    | **Canvas 2D** + **Off-screen Canvas** / **WebCodecs** (動画)、**WebGL/CanvasKit** (高度なフィルタ) | モバイル Safari/Chrome の HW アクセラレーションと互換      |
| UI フレームワーク | React（Next.js でも可） + Zustand/Recoil（状態管理）                                                | 厳密レイテンシ要件はないが Undo/Redo が重要               |
| 描画制御       | Fabric.js または Konva.js                                                                   | マルチレイヤ + トランスフォームが楽                       |
| タッチジェスチャ   | Hammer.js / use-gesture                                                                  | ピンチ拡大・回転・2 本指描画                           |
| エクスポート     | `canvas.toBlob()` → WebP/PNG、動画は **MediaRecorder** / **ffmpeg.wasm**                     | iOS Safari の WebCodecs 対応が不完全な場合 Fallback |
| 型定義        | TypeScript (strict)                                                                      | `StoryCanvasState` 型を中心に                  |

---

## 2. データモデル（クライアント内部）

```ts
/** ビットマップに焼き込むレイヤ */
interface DrawableLayer {
  id: string;
  kind: "image" | "video" | "text" | "draw" | "shape";
  /** 0–1 正規化座標 */
  bbox: [number, number, number, number];
  rotation: number;          // degree
  opacity: number;           // 0–1
  /** text →フォント情報 / draw →ストローク配列 / shape →SVG Path 等 */
  payload: any;
  z: number;
}

/** 意味付きオーバーレイ（ActivityStreams へそのまま投影） */
interface SemanticOverlay /* extends x:overlay */ {
  id: string;
  kind: "mention" | "place" | "question" | "link";
  ref: string;               // tag / attachment / place の ID
  bbox: [number, number, number, number];
  rotation: number;
  z: number;
  style?: Record<string, any>;
  tapAction?: string;
}

interface StoryCanvasState {
  baseMedia: {
    kind: "image" | "video";
    url: string;             // local blob URL
    width: number;
    height: number;
    duration?: number;       // video
  };
  drawableLayers: DrawableLayer[];
  semanticOverlays: SemanticOverlay[];
  aspectRatio: 9 / 16;
  history: DrawableLayer[][]; // Undo/Redo
}
```

### ポイント

1. **描画用レイヤ (`DrawableLayer`) と意味レイヤ (`SemanticOverlay`) を厳密に分離**

   * 保存時に **drawableLayers のみマージして 1 枚のビットマップ出力**
   * semanticOverlays はそのまま JSON としてパックし、アップロード後に ActivityStreams の `x:overlays` へ移植
2. `bbox` は **0-1 正規化** → ビデオなど解像度可変でも崩れない
3. テキストのフォント・ストロークは **端末に依存しないアウトライン描画**（CanvasKit / path2D）推奨

---

## 3. UI レイヤ構造

```text
┌───────────────────────────────────────┐
│              React UI                │
│ ┌──────────── Overlay HUD ──────────┐ │  ← SemanticOverlay を表示・編集
│ │  MentionChip  QuestionCard  …     │ │
│ └───────────────────────────────────┘ │
│ ┌───────────── CanvasPane ──────────┐ │  ← Fabric.js / Konva Stage
│ │  (Base Media)                     │ │
│ │  └─ DrawableLayer(s)              │ │  ← 文字 / 落書き / スタンプ
│ └───────────────────────────────────┘ │
│        Controls / Toolbar            │
└───────────────────────────────────────┘
```

* **CanvasPane**

  * Base Media + DrawableLayer を合成。
  * 選択／移動／ピンチズーム／ローテートを Fabric.js のオブジェクトにマップする。
* **Overlay HUD**

  * semanticOverlays を React コンポーネントで描画（CSS transform: scale/rotate）。
  * 編集モードではドラッグして `bbox` を更新、確定後は pointer-events\:none（タップ時のみイベント）。
* **Toolbar**

  * 描画モード（ペン／蛍光／消しゴム）、テキスト入力、スタンプ追加、質問箱追加…
  * モバイル UX：長押しでカラーピッカー、ダブルタップでテキスト編集。

---

## 4. ビットマップ書き出しフロー

1. `await preloadMedia(baseMedia.url)`
2. **オフスクリーン Canvas** を 1080×1920（推奨）で生成
3. Base Media → DrawableLayer (z昇順) を逐次 draw
4. `canvas.toBlob("image/webp", quality=0.95)`
5. 動画の場合:

   * Canvas を `requestVideoFrameCallback` で逐次描画し **WebCodecs + MediaRecorder** で H.264/VP9 生成
   * フィルタが重い場合は WebGL or offload to server ffmpeg

> **注意**: semanticOverlays は描画しない。

---

## 5. ActivityStreams への変換

```ts
function toActivityStreams(state: StoryCanvasState, blobUrl: string): any {
  const objectId = generateId();
  const overlays = state.semanticOverlays.map(o => ({
    id: o.id,
    kind: o.kind,
    ref: o.ref,
    bbox: o.bbox,
    rotation: o.rotation,
    z: o.z,
    style: o.style,
    tapAction: o.tapAction
  }));

  const obj: any = {
    "@context": ["https://www.w3.org/ns/activitystreams", {"x":"https://example.com/ns#"}],
    id: objectId,
    type: [state.baseMedia.kind === "image" ? "Image" : "Video", "x:Story"],
    mediaType: state.baseMedia.kind === "image" ? "image/webp" : "video/mp4",
    url: {
      type: "Link",
      href: blobUrl,
      width: 1080,
      height: 1920
    },
    published: new Date().toISOString(),
    endTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    "x:overlays": overlays
  };

  return {
    type: "Create",
    actor: currentUser.actor,
    to: [currentUser.followers],
    object: obj
  };
}
```

---

## 6. Undo / Redo & 履歴

* **Zustand** で `drawableLayers`, `semanticOverlays` を個別ストア。
* **Immer** + **time-travel middleware** で 50 ステップ程度保持。
* semanticOverlays は軽量なので履歴に含めて OK。

---

## 7. アクセシビリティ & i18n

* テキスト入力時に `alt` / `title` を同時入力させ、AS2 `summary` へ格納。
* 右→左言語は `direction:rtl` を DrawableLayer payload に保持。
* カラーパレットは WCAG AA コントラストラインを提示（白背景想定）。

---

## 8. テスト & CI

| テスト種別   | 方法                         | 合格基準                       |
| ------- | -------------------------- | -------------------------- |
| E2E 操作  | Playwright (モバイル viewport) | 画面タップ → 書き出し → AS2 JSON 検証 |
| 並行操作    | 2 本指ズーム＋移動                 | FPS 30 以上維持                |
| オフライン保存 | IndexedDB Draft            | 復帰後5 秒以内に自動リロード            |
| 型安全     | `tsc --noEmit`             | エラー 0                      |
| ペイロード検証 | AJV で JSON Schema          | x\:overlay スキーマ準拠          |

---

## 9. 参考実装順序

1. **Canvas レイヤリング**（画像のみ）
2. **テキスト／描画ツール**
3. **SemanticOverlay UI**（メンション → 質問箱 → 位置情報）
4. **動画サポート**（WebCodecs or ffmpeg.wasm）
5. **Undo/Redo & Draft 保存**
6. **AS2 書き出し + アップロード統合**