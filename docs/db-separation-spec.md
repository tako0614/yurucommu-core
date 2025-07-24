# takos と takos host のデータベース分離設計

## 1. 目的

- 単体インスタンス向けの **takos** と、複数インスタンスを統合管理する **takos
  host** で、それぞれ独立したデータベーススキーマを採用する。
- 共有ロジックでは抽象化された DB 操作を経由し、実装の違いを隠蔽する。
- 既存との互換性は考慮しない。

## 2. 共通インターフェース

```ts
interface DB {
  getObject(id: string): Promise<Object | null>;
  saveObject(obj: Object): Promise<void>;
  listTimeline(actor: string, opts: ListOpts): Promise<Object[]>;
  follow(follower: string, target: string): Promise<void>;
  unfollow?(follower: string, target: string): Promise<void>;
  listAccounts(): Promise<Object[]>;
  createAccount(data: Object): Promise<Object>;
  findAccountById(id: string): Promise<Object | null>;
  findAccountByUserName(name: string): Promise<Object | null>;
  updateAccountById(id: string, u: Object): Promise<Object | null>;
  deleteAccountById(id: string): Promise<boolean>;
  addFollower(id: string, follower: string): Promise<string[]>;
  removeFollower(id: string, follower: string): Promise<string[]>;
  addFollowing(id: string, target: string): Promise<string[]>;
  removeFollowing(id: string, target: string): Promise<string[]>;
  // ...必要に応じて追加
}

// 実装選択用ユーティリティ
export function createDB(env: Record<string, string>): DB {
  return env["DB_MODE"] === "host"
    ? new MongoDBHost(env)
    : new MongoDBLocal(env);
}
```

`DB_MODE` に `host` を指定すると、takos host 用の `MongoDBHost`
実装が選ばれる。省略時は `MongoDBLocal` が使われる。

- `DB` を実装するクラスを切り替えることで、takos と takos host
  の処理を分離する。
- アプリケーションコードは `DB` のメソッドのみを使用する。

## 3. takos 向けスキーマ

- 各インスタンスが **独立した MongoDB データベース** を使用する。
- 主なコレクション案
  - `object_store` : ActivityPub オブジェクト
  - `account` : ローカルアカウント
  - `follow_edge` : フォロー関係
  - そのほか既存コレクションをインスタンス単位で保持
- テナント ID は不要。ドメインごとに DB を分けるため、スキーマはシンプルになる。

## 4. takos host 向けスキーマ

- **単一の MongoDB クラスター** に複数インスタンスのデータを集約する。
- 基本設計は `app/takos_host/unified_object_store.md` を踏襲。
- 主なコレクション案
  - `object_store` : `_id` で一意なオブジェクトを保存し `tenant_id` で区別
  - `tenant` : インスタンス情報 (ドメインなど)
  - `follow_edge` : `{ tenant_id, actor_id, ... }`
  - `relays` : `{ tenant_id, host, inboxUrl, since }`
- すべてのクエリで `tenant_id` を条件に含め、データが混在しないようにする。

## 5. 実装方針

1. `shared/db.ts` などに `DB` インターフェースと共通型を定義する。
2. `app/api` ではインスタンス単位の `MongoDBLocal` 実装を提供する。
3. `app/api/DB/mod.ts` に `MongoDBHost` を含め、統合スキーマを扱う。
4. 既存のモデルやサービス層は `DB` を受け取る形に書き換え、直接 mongoose
   モデルを参照しないようにする。
5. テストやスクリプトからも `DB` 実装を選択できるようにする。

## 6. 移行について

- 旧スキーマからのデータ移行は考慮しない。必要であれば個別にバックフィルスクリプトを用意する。
- コードベースは `DB`
  インターフェースへの依存に統一し、新旧モデルが混在しないよう整理する。
