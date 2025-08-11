# UI/UX ガイドライン（フロントエンド）

本ドキュメントは takos の UI/UX 改善方針と、実装済みの共通コンポーネント／デザイントークンの使い方をまとめたものです。

## デザイントークン（CSS 変数）

`app/client/src/App.css` に以下の変数を定義しています。色・角丸・影などを一元管理します。

- 色: `--color-bg`, `--color-surface`, `--color-elevated`, `--color-text`, `--color-muted`, `--color-border`, `--color-primary`
- 角丸: `--radius-sm`, `--radius-md`, `--radius-lg`
- 影: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- フォーカス: `--focus-ring`

Tailwind を併用しつつ、統一した見た目が必要なところは変数を参照してください。

## アクセシビリティ

- すべてのフォーカス可能要素で `:focus-visible` によるリングを表示します（キーボードユーザーが見失わないため）。
- スキップリンクを `index.html` に追加済み：`Tab` キーで「メインコンテンツにスキップ」へ移動できます。
- モーダルは `role="dialog"` と `aria-modal="true"` を付与した `Modal` コンポーネントで提供します。

## 共通 UI コンポーネント

配置場所: `app/client/src/components/ui/`

- `Button`: バリエーション（`primary|secondary|ghost|danger`）とサイズ（`sm|md|lg`）を指定可能。
- `Input`: `label`, `hint`, `error` 対応のアクセシブルな入力コンポーネント。
- `Card`: 統一された面（surface）スタイルのコンテナ。
- `Modal`: アクセシブルなダイアログ。`open` と `onClose` を必須にし、Esc/背景クリックで閉じます。
- `Spinner`: シンプルなローディングインジケータ。
- `EmptyState`: 空状態の表示用コンポーネント。

使い方例（Button と Input）:

```tsx
<Card>
  <form class="space-y-4">
    <Input label="名前" placeholder="山田 太郎" />
    <Button type="submit" class="w-full">保存</Button>
  </form>
  
</Card>
```

## 既存画面の変更点（サマリ）

- ログイン画面: `Card`, `Input`, `Button` を用いて視認性と一貫性を改善。
- 暗号化キー入力: `Modal` を採用し、Esc・背景クリックで閉じられるアクセシブルなダイアログに変更。
- チャット: ルームが空のとき `EmptyState` を表示して、何をすれば良いかが伝わるように。

## 今後の改善候補

- フォームバリデーションの一元化（zod 等）
- トースト通知の共通化（成功/エラーの即時フィードバック）
- コンポーネント単位の E2E/スナップショットテスト追加

