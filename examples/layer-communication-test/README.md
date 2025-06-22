# Layer Communication Test Extension

このテスト拡張機能は、Takos拡張機能のレイヤー間（UI、Server、Client）での関数呼び出しとイベント通信をテストするためのものです。

## 📋 テスト内容

### 1. レイヤー間関数呼び出し
- **UI → Server**: UI層からサーバー関数を直接呼び出し
- **UI → Client**: UI層からクライアント関数を直接呼び出し  
- **Server → Client**: サーバー層からクライアント関数を直接呼び出し
- **Client → Server**: クライアント層からサーバー関数を直接呼び出し

### 2. レイヤー間イベント通信
- **UI → Server**: UIからサーバーにイベント送信
- **UI → Client**: UIからクライアントにイベント送信
- **Server → UI**: サーバーからUIにイベント送信
- **Server → Client**: サーバーからクライアントにイベント送信
- **Client → UI**: クライアントからUIにイベント送信
- **Client → Server**: クライアントからサーバーにイベント送信

## 🔧 使用方法

### ビルド
```bash
cd examples/layer-communication-test
deno task build
```

### テスト実行
1. 生成された `.takopack` ファイルをTakosにインストール
2. 拡張機能のUIページを開く
3. 各ボタンをクリックしてテストを実行
4. 結果は下部の出力パネルに表示されます

## 🧪 テストシナリオ

### UIレイヤーからのテスト
- **Server関数を呼び出し**: `serverFunction()` を直接呼び出してレスポンスを確認
- **Client関数を呼び出し**: `clientFunction()` を直接呼び出してレスポンスを確認
- **Serverにイベント送信**: `uiToServer` イベントを送信して処理結果を確認
- **Clientにイベント送信**: `uiToClient` イベントを送信

### Serverレイヤーからのテスト
- **Clientテストを実行**: サーバーからクライアント関数を呼び出し
- **Server受信イベント確認**: UIとClientから受信したイベントの履歴を確認

### Clientレイヤーからのテスト
- **Serverテストを実行**: クライアントからサーバー関数を呼び出し
- **Client受信イベント確認**: UIとServerから受信したイベントの履歴を確認

## 📊 期待される結果

### 成功パターン
- 各関数呼び出しで適切なレスポンスオブジェクトが返される
- イベント送信が正常に完了し、受信側でハンドラーが実行される
- KVストレージにイベント履歴が保存される

### エラーパターン  
- 拡張機能が見つからない場合のエラーハンドリング
- 権限不足によるAPIアクセス失敗
- ネットワークエラーや通信障害

## 🔍 デバッグ情報

### ログ出力
各レイヤーでの処理はコンソールにログ出力されます：
- `[UI]` : UI層での処理
- `[Server]` : サーバー層での処理  
- `[Client]` : クライアント層での処理

### KVストレージ
受信したイベントは以下のキーでKVストレージに保存されます：
- `lastServerToClientEvent` : サーバーからクライアントへのイベント
- `lastUIToServerEvent` : UIからサーバーへのイベント
- `lastClientToServerEvent` : クライアントからサーバーへのイベント
- `lastServerToUIEvent` : サーバーからUIへのイベント（UI側KV）
- `lastClientToUIEvent` : クライアントからUIへのイベント（UI側KV）
- `lastUIToClientEvent` : UIからクライアントへのイベント（Client側KV）

## 🛠 技術詳細

### 権限
```json
{
  "permissions": [
    "events:publish",
    "extensions:invoke", 
    "extensions:export",
    "kv:read",
    "kv:write"
  ]
}
```

### エクスポート関数
- `serverFunction` : サーバー層の公開関数
- `clientFunction` : クライアント層の公開関数  
- `uiFunction` : UI層の公開関数

### イベント定義
- 各レイヤー間の双方向イベント通信をサポート
- ハンドラー関数で受信したイベントを処理
- 処理結果をKVストレージに保存

このテスト拡張機能により、Takos v3仕様でのレイヤー間通信が正しく動作することを確認できます。
