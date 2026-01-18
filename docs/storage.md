# ストレージ管理

Yurucommuは複数のオブジェクトストレージバックエンドをサポートします。

## サポートされるバックエンド

| バックエンド | 用途 | 説明 |
|-------------|-----|------|
| Cloudflare R2 | 本番環境 | Cloudflare Workers向け |
| AWS S3 | セルフホスト | S3互換サービス対応 |
| MinIO | セルフホスト | オープンソースS3互換 |
| ローカルファイルシステム | 開発環境 | ファイルベース |

## 使用方法

### Cloudflare R2

```typescript
import { getR2Storage } from './lib/storage';

export default {
  async fetch(request: Request, env: Env) {
    const storage = getR2Storage(env.MEDIA);

    // アップロード
    await storage.put('images/photo.jpg', imageBuffer, {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    // ダウンロード
    const obj = await storage.get('images/photo.jpg');
    if (obj) {
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' },
      });
    }
  }
};
```

### S3互換ストレージ (AWS S3, MinIO等)

```typescript
import { getS3Storage } from './lib/storage';

const storage = await getS3Storage({
  endpoint: 'https://s3.amazonaws.com', // or 'http://localhost:9000' for MinIO
  bucket: 'yurucommu-media',
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
  region: 'ap-northeast-1', // optional
});

// アップロード
await storage.put('images/photo.jpg', imageBuffer, {
  httpMetadata: { contentType: 'image/jpeg' },
});

// ダウンロード
const obj = await storage.get('images/photo.jpg');
```

### ローカルファイルシステム

```typescript
import { getFilesystemStorage } from './lib/storage';

const storage = await getFilesystemStorage({
  basePath: './data/storage',
});

// アップロード
await storage.put('images/photo.jpg', imageBuffer, {
  httpMetadata: { contentType: 'image/jpeg' },
});

// ダウンロード
const obj = await storage.get('images/photo.jpg');
```

### ファクトリ関数

```typescript
import { createStorage } from './lib/storage';

// R2
const r2Storage = await createStorage({
  type: 'r2',
  bucket: env.MEDIA,
});

// S3
const s3Storage = await createStorage({
  type: 's3',
  config: {
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'yurucommu-media',
    accessKeyId: 'xxx',
    secretAccessKey: 'xxx',
  },
});

// Filesystem
const fsStorage = await createStorage({
  type: 'filesystem',
  config: {
    basePath: './data/storage',
  },
});
```

## 環境変数

### S3互換ストレージ

| 変数名 | 説明 | 例 |
|-------|-----|-----|
| `S3_ENDPOINT` | S3エンドポイント | `https://s3.amazonaws.com` |
| `S3_BUCKET` | バケット名 | `yurucommu-media` |
| `S3_ACCESS_KEY` | アクセスキー | - |
| `S3_SECRET_KEY` | シークレットキー | - |
| `S3_REGION` | リージョン (optional) | `ap-northeast-1` |

### ローカルストレージ

| 変数名 | 説明 | 例 |
|-------|-----|-----|
| `STORAGE_PATH` | ストレージパス | `./data/storage` |

## API

### Storage インターフェース

```typescript
interface Storage {
  // オブジェクトをアップロード
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, options?: PutOptions): Promise<void>;

  // オブジェクトを取得
  get(key: string): Promise<StorageObject | null>;

  // オブジェクトを削除
  delete(key: string | string[]): Promise<void>;

  // オブジェクト一覧
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ListResult>;

  // メタデータのみ取得
  head(key: string): Promise<{ size: number; etag?: string; httpMetadata?: PutOptions['httpMetadata'] } | null>;
}
```

### PutOptions

```typescript
interface PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
}
```

### StorageObject

```typescript
interface StorageObject {
  key: string;
  body: ReadableStream<Uint8Array> | null;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  size: number;
  etag?: string;
  httpMetadata?: { contentType?: string; ... };
  customMetadata?: Record<string, string>;
}
```

## MinIOセットアップ

開発環境でMinIOを使用する場合：

```bash
# Dockerで起動
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio_data:/data \
  minio/minio server /data --console-address ":9001"
```

MinIO Console: http://localhost:9001

環境変数：
```bash
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=yurucommu-media
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

## 推奨構成

### 開発環境
- **ローカルファイルシステム**: シンプルで設定不要

### セルフホスト (小規模)
- **ローカルファイルシステム**: サーバーのディスクに直接保存

### セルフホスト (中〜大規模)
- **MinIO**: オープンソースS3互換、スケーラブル
- **AWS S3**: マネージドサービス、高可用性

### Cloudflare Workers
- **R2**: 最適化されたCloudflare統合
