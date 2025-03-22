# takos call の仕様

## 1. 概要

**takos protocol** での標準通話機能は以下の技術を使用します：
- **WebRTC SFU**: 「mediasoup」またはその互換サーバー
- **シグナリング**: WebSocketプロトコル

## 2. システムアーキテクチャ

### 外部サーバーとの通話方法

- takos foundation apiで**token**を公開
- SFUサーバーはfriendの場合、通話リクエストしたユーザーのサーバーに接続
- SFUサーバーはgroupの場合、グループのサーバーに接続

## 3. 接続の流れ

> foundation apiの通信の詳細は他のドキュメントを参照

### 3.1 友達間の通話制御

| メッセージ | 説明 | パラメータ | レスポンス |
|------------|------|------------| -----------|
| `t.friend.call.request` | 通話リクエスト送信 | `{ roomKeyhash?: string, isEncrypt: boomlan, friendId: string, userId: string }` | - |
| `t.friend.call.accept` | 通話リクエスト受け入れ | `{ userId: string, friendId: string }` | `{ token: string }` |
| `t.friend.call.reject` | 通話リクエスト拒否 | `{ userId: string, friendId: string }` | - |
| `t.friend.call.cancel` | 通話リクエストキャンセル | `{ userId: string, friendId: string }` | - |

# 3.2 グループの通話制御

| メッセージ | 説明 | パラメータ | レスポンス |
|------------|------|------------| -----------|
| `t.group.call.request` | 通話開始リクエスト送信 | `{ roomKeyhash?: string, isEncrypt: boomlan, roomId: string, userId: string }` | `{ ok: boomlan, token: string }` |
| `t.group.call.join` | 通話参加リクエスト送信 | `{ userId: string, roomId: string }` | `{ ok: boolean, token: string }` |


### 3.3 サーバー接続

**エンドポイント**: `/_takos/v2/call?token=xxxx`

#### 初期化メッセージ

接続時にサーバーから送信されるメッセージ:

text通話の場合は webRTC関連の情報は不要
?がついているやつはtext通話の場合は不要
それ以外は必要

```typescript
{
  type: "init",
  data: {
    roomId: string,
    peers: string[],
    callType: "audio" | "video" | "text",
    routerRtpCapabilities?: any,
    transport?: {
        send: {
            id: string,
            iceParameters: string,
            iceCandidates: string,
            dtlsParameters: string,
            sctpParameters: string,
        },
        recv: {
            id: string,
            iceParameters: string,
            iceCandidates: string,
            dtlsParameters: string,
            sctpParameters: string,
        }
    },
    producers?: {
        id: string;
        peerId: string;
        kind: string;
    }[],
  }
}
```

#### ユーザー参加通知

他のユーザー接続時に送信されるメッセージ:

```typescript
{
  type: "join",
  peerId: string,
  producers?: {
    id: string;
    kind: string;
  }[],
}
```

#### ユーザー退出通知

他のユーザー切断時に送信されるメッセージ:

```typescript
{
  type: "leave",
  peerId: string,
}
```

### text通話専用api

メッセージ送信

```typescript
{
    type: "message",
    message: string,
    sign: string,
}
```

メッセージ受信

```typescript
{
    type: "message",
    message: string,
    sign: string,
}
```

以下text通話の場合は不要

#### トランスポート確立

クライアントは mediasoup-client などで init の情報から初期化後、以下を送信:

```typescript
{
    type: "connect",
    dtlsParameters: string,
}
```

接続成功時にサーバーから送信されるメッセージ:

```typescript
{
    type: "connected",
    transportType: "send" | "recv",
}
```

## 4. メディア送受信

### 4.1 プロデューサー作成

クライアントからのプロデューサー作成リクエスト:

```typescript
// import { RtpParameters } from "mediasoup-client/types";
{
    type: "produce",
    kind: "audio" | "video",
    rtpParameters: RtpParameters,
}
```

### 4.2 プロデューサー通知

他クライアントへのプロデューサー作成通知:

```typescript
{
    type: "newProducer",
    producerId: string,
    peerId: string,
    kind: "audio" | "video",
}
```

### 4.3 コンシューマー作成

クライアントからのコンシューマー作成リクエスト:

```typescript
// import { RtpParameters } from "mediasoup-client/types";
{
    type: "consume",
    producerId: string,
    rtpCapabilities: RtpCapabilities,
}
```

## 5. リソース終了

### 5.1 プロデューサー終了

```typescript
{
    type: "closeProducer",
    producerId: string,
}
```

### 5.2 コンシューマー終了

```typescript
{
    type: "closeConsumer",
    consumerId: string,
}
```

> または、`producer.close()`や`consumer.close()`メソッドで終了可能

## 6. 通話終了

通話終了方法:
1. WebSocketの切断
2. または以下のメッセージ送信:

```typescript
{
    type: "bye",
}
```
