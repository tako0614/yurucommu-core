以下は **「既存DBとTypeScript(Deno/Hono想定)
に“興味関心ベース推薦”を追加実装するための具体的仕様」**
です。(現在この機能は廃止されています)
AIモデルや外部APIに依存せず、タグ・キーワード・閲覧/いいね履歴のみで実現します。

---

## 1. 要求仕様 (機能要件)

1. ユーザーが過去に興味を示した投稿（閲覧、いいね、リブログ等）や、事前に設定した興味関心タグに基づき類似投稿を推薦する。
2. API: `GET /api/recommendations` で最大 N 件の投稿を返す。
3. リアルタイム性: ユーザー行動が発生したら遅延なくプロファイル更新（同期 or
   短時間バッチ）。
4. コールドスタート: 行動履歴がない場合は「ユーザーの明示的興味タグ」→
   なければ「全体トレンド」を返す。
5. パフォーマンス: 単一ユーザーの推薦を 50ms 以内（DB
   I/Oを除く）で計算可能にする。
6. 冪等性:
   同じリクエストで順序が安定するようスコア＋二次キー(created\_atなど)でソート。

---

## 2. データモデル (DBは既存想定・新規列/テーブルのみ)

### 2.1 新規テーブル/列

**ユーザープロファイルキャッシュ (user\_interest\_profiles)**

| カラム           | 型        | 説明                            |
| ---------------- | --------- | ------------------------------- |
| user\_id (PK)    | string    | ユーザーID                      |
| tag\_weights     | JSON      | `{tag: number}` 重み (正規化済) |
| keyword\_weights | JSON      | `{token: number}` 重み (任意)   |
| updated\_at      | timestamp | 最終更新                        |

**投稿特徴量拡張 (posts テーブルにカラム追加)**

| カラム                | 型        | 説明                                   |
| --------------------- | --------- | -------------------------------------- |
| tags                  | text\[]   | 既存 or 追加                           |
| keyword\_vector       | JSON      | `{token: number}` (トークン出現頻度TF) |
| score\_cache\_indices | GIN index | `tags` / JSON Path index で高速検索    |

> 既にキーワード抽出処理が無ければ、簡易トークナイザ(正規表現で日本語/英数字切り出し)＋ストップワード除去で
> TF を計算し保存。TF-IDF の IDF
> は全投稿数/出現投稿数でバッチ計算し、`keyword_vector` 保存時に TF×IDF
> を数値化。

---

## 3. 重み更新ロジック

### 3.1 初期化

ユーザー登録/明示興味タグ設定時:

```ts
tagWeights = normalize({ tagA:1, tagB:1, ... });
keywordWeights = {};
```

### 3.2 行動イベントフック

既存の「いいね」「閲覧」「リブログ」などイベント発生箇所にフックを追加:

```ts
onUserAction(userId: string, postId: string, type: 'view'|'like'|'boost') {
  queue.enqueue({userId, postId, type, timestamp: Date.now()});
}
```

### 3.3 更新処理ワーカー

キューを処理し `user_interest_profiles` を更新。 重み付け例:

| イベント     | 基本増分 (α) |
| ------------ | ------------ |
| view         | 1            |
| like         | 3            |
| boost/reblog | 4            |

Pseudo:

```ts
function applyEvent(profile, post, type) {
  const inc = { view: 1, like: 3, boost: 4 }[type];
  for (const t of post.tags) {
    profile.tagWeights[t] = (profile.tagWeights[t] ?? 0) + inc;
  }
  for (const [token, w] of Object.entries(post.keyword_vector)) {
    profile.keywordWeights[token] = (profile.keywordWeights[token] ?? 0) +
      inc * w;
  }
}
```

### 3.4 時間減衰 (新規性確保)

バッチ(1日1回)または更新時に減衰:

```
weight = weight * exp(-λ * Δdays)    (λ例:0.05)
```

極小値(<0.01)は削除。更新後、各カテゴリで L2 正規化または合計1に正規化。

---

## 4. 推薦スコア計算

### 4.1 候補取得

ユーザープロファイル上位タグ上位 k 個 (例:5) を取得し、以下SQLで候補投稿を絞る:

```sql
SELECT * FROM posts
WHERE tags && ARRAY[$1,$2,...]  -- overlap
AND author_id != $user           -- 自分除外(任意)
AND created_at > now() - interval '30 days'  -- 新鮮さ
LIMIT 500;
```

### 4.2 スコアリング

スコア要素:

```
tagScore = Σ (user.tagWeights[tag] * TAG_WEIGHT_COEF)
keywordScore = cosine(user.keywordWeights, post.keyword_vector) * KEYWORD_COEF
recencyBonus = exp(-μ * hoursSincePost)  (μ例:0.01)
finalScore = tagScore + keywordScore + recencyBonus
```

`cosine` 計算用にユーザー/投稿側で正規化済みベクトルを保持。 `TAG_WEIGHT_COEF`
と `KEYWORD_COEF` は環境変数で調整 (初期値 1.0 / 0.5 等)。

### 4.3 ソートとフィルタ

- 除外: ユーザーが既に見た/いいねした投稿 (履歴テーブル参照)。
- ソート: `ORDER BY finalScore DESC, created_at DESC`
- 上位 N (例:20) を返却。
- キャッシュ: ユーザーごとに 5 分間メモリ/LRU に保存 (再計算削減)。

---

## 5. API 実装

### 5.1 ルータ (Hono例)

```ts
app.get("/api/recommendations", authMiddleware, async (c) => {
  const userId = c.var.user.id;
  const recs = await recommendationService.getRecommendations(userId, {
    limit: 20,
  });
  return c.json(recs);
});
```

### 5.2 Service 層

```ts
class RecommendationService {
  async getRecommendations(userId: string, { limit }: { limit: number }) {
    const profile = await this.loadProfile(userId);
    if (!profile) return this.coldStart(userId, limit);
    const candidates = await this.fetchCandidates(profile);
    const scored = this.score(profile, candidates);
    return scored.slice(0, limit);
  }
}
```

---

## 6. バッチ/バックグラウンド

| 処理             | 頻度     | 内容                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| プロファイル減衰 | 1日1回   | 全ユーザー weights 減衰→正規化                                            |
| IDF再計算        | 週1回    | 全投稿から token -> docFreq → IDF 更新。`keyword_vector` 再生成（非同期） |
| トレンド投稿更新 | 10分おき | コールドスタート用: 直近いいね数などでランキング                          |

---

## 7. エラー・フォールバック

1. プロファイル無し → `coldStart` (明示タグ→トレンド)。
2. 候補0件 → 探索範囲拡大 (期間延長 / トレンド混ぜ)。
3. ベクトル計算失敗 → ログ出力しタグベーススコアのみ。

---

## 8. セキュリティ/プライバシ

- プロファイルJSONは公開APIに返さない。
- 明示削除リクエストで `user_interest_profiles` 行を削除し再生成可能。
- PII含むカラムは使用しない。

---

## 9. 導入手順

1. **DBマイグレーション**: 新規テーブル/カラム追加・インデックス作成。
2. **投稿保存フック追加**: 投稿作成時に `keyword_vector` (TF×IDF) を生成し保存。
3. **イベントフック追加**: 既存「いいね/閲覧」処理内でキュー enqueue。
4. **ワーカー実装**: キューコンシューマで `user_interest_profiles` 更新。
5. **バッチスクリプト**: 減衰・IDF再計算 cron 登録。
6. **RecommendationService** 実装＋ API エンドポイント追加。
7. **キャッシュ層 (メモリ/LRU)** 導入。
8. **計測**: ログにスコア計算時間とクリック率を記録→係数調整。

---

## 10. テスト計画 (抜粋)

| 種類        | ケース                                    |
| ----------- | ----------------------------------------- |
| Unit        | 重み更新 / 減衰計算 / cosine              |
| Integration | イベント→プロファイル更新→API応答         |
| Load        | 1,000ユーザー並列リクエストで応答時間測定 |
| Regression  | コールドスタート時のフォールバック        |

---

必要に応じて、サンプルコードやマイグレーションスクリプトも作成できます。次はどの部分を詳しく書き起こしましょうか？
