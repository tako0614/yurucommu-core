# ChatMessage オブジェクト仕様

## 🔑 1. 目的・位置づけ

- **目的**：ActivityPub 互換のメッセージを、**単一のマルチレシピエント KEM**
  で鍵共有しながら、暗号化／非暗号化を切り替えつつ **耐量子安全かつ小サイズ**
  で送受信する。

  - 鍵包化方式を **mKEM（マルチレシピエント KEM）** に統一
  - **mKEM
    暗号文は原則として外部URL化**し、本文に直接インライン化する方式は例外的
  - 添付ファイルはメッセージ共有鍵 **K** を再利用（`crypto:keyId` を廃止）
  - 明示的な鍵ライフサイクル管理を導入。

---

## 🔐 2. 使用アルゴリズムと用語

- sharedKey K から以下のようにサブキーを派生して使用
  - 本文用サブキー: `HKDF-Expand(K, "body")`
  - 添付用サブキー: `HKDF-Expand(K, "attachment")`

| 用途       | アルゴリズム                                             | 説明                                                                         |
| ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 本文暗号   | **AES-256-GCM (sub-key = HKDF-Expand(K, "body"))**       | 12 byte IV (96bit)＋16 byte TAG。IV はメッセージごとに一意となるようにする。 |
| 添付暗号   | **AES-256-GCM (sub-key = HKDF-Expand(K, "attachment"))** | 12 byte IV＋16 byte TAG。                                                    |
| **鍵包化** | **mHPKE-Base(ML-KEM-768-mR, HKDF-SHA-512, AES-256-GCM)** | ML-KEM 派生 mKEM。暗号文長は O(N) で N≤500 程度まで実用                      |
| 署名       | **ML-DSA-44**                                            | RFC 9381 draft 相当                                                          |

**用語**

| 用語            | 意味                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| **accountKey**  | ML‑KEM 公開鍵（各受信者）                                                       |
| **sharedKey K** | mKEM で一括共有される AES 対称鍵（本文/添付共通、メッセージ毎にローテーション） |
| **signingKey**  | ML‑DSA 公開鍵（送信者）                                                         |

> 🔗 **アルゴリズム識別子はキーに集約** — すべてのキー（accountKey,
> signingKey）は `crypto:algorithm` メタデータを保持し、 メッセージ側は
> `crypto:keyId` ではなく \*\*暗号文 \*\*\`\` のみで鍵を参照。

---

## 🔃 3. 鍵ライフサイクル管理

| 鍵の種類   | 推奨ローテーション頻度  | 方法                                                      |
| ---------- | ----------------------- | --------------------------------------------------------- |
| accountKey | 最大10日ごと（TTL参照） | サービスはTTL前に新鍵を公開、旧鍵はTTL終了まで併存利用    |
| signingKey | 最大30日ごと            | `signingKeyUrl` は常に最新鍵、古い署名は keyId 指定で参照 |

- 受信者側は TTL 期限切れ前に必ず更新を行う。
- サービス側は Rate Limit を設ける。

---

## 🌐 4. Actor プロファイル拡張

`accountKey` と `signingKey` だけを公開します。
オプションで **masterKey**
による鍵署名を追加できます（クライアント側で鍵の真正性を検証）。

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://example.com/ns/crypto#"
  ],
  "type": "Person",
  "id": "https://example.com/users/alice",
  "preferredUsername": "alice",
  "crypto:keyService": {
    "crypto:accountKeyUrl": "https://keys.example.com/alice/accountKey",
    "crypto:signingKeyUrl": "https://keys.example.com/alice/signingKey?keyId={keyId}",
    "crypto:masterKeyUrl": "https://keys.example.com/alice/masterKey", // 追加: masterKey 用 URL
    "crypto:ttl": "P10D"
  }
}
```

---

## 📨 5. ChatMessage JSON‑LD 構造 (改訂)

```jsonc
{
  "@context": "https://example.com/ns/crypto#",
  "specVersion": "1.1",
  "type": "ChatMessage",
  "id": "https://example.com/messages/123",
  "attributedTo": "https://example.com/users/alice",
  "to": [
    "https://example.org/users/bob",
    "https://fedi.example.net/users/carla"
  ],
  "conversation": "https://example.com/conversations/42",
  "inReplyTo": "https://example.com/messages/120",
  "published": "2025-05-03T14:30:00+09:00",

  "crypto:isEncrypted": true,
  "crypto:kemCipherTextUrl": "https://example.com/kemCipherText/123",
  "crypto:cipherText": "Base64URL(iv‖ciphertext‖tag)",

  /* ---------- 添付 ---------- */
  "attachment": [{
    "type": "ChatAttachment",
    "mediaType": "image/png",

    /* ▼暗号化ファイル (GCM) — 鍵は sharedKey K を再利用 */
    "url": "https://example.com/media/img1", // 暗号化されたコンテンツ (ciphertext)
    "crypto:encrypted": true,
    "crypto:iv": "Base64URL(ivBytes)",
    "crypto:tag": "Base64URL(tagBytes)"
    /* ▲平文ファイルの場合:
       "url": "https://example.com/media/img1.png",
       "crypto:encrypted": false */
  }],

  /* ---------- 署名（必須） ---------- */
  "crypto:signature": {
    "crypto:keyId": "sigkey-ef56",
    "crypto:algorithm": "ML-DSA-44",
    "crypto:signatureUrl": "https://example.com/messages/123.sig",
    "crypto:created": "2025-05-03T14:30:05+09:00"
  }
}
```

### 4.1 mKEM 暗号文フォーマット

```
ct = kemCt ‖ ( hint₁ ‖ tag₁ ) ‖ ( hint₂ ‖ tag₂ ) ‖ … ‖ ( hint_N ‖ tag_N )
```

```
// hint_i = p (1 byte ランダムプレフィックス) ‖ Trunc15(BLAKE3-Salt(p, userId || KemCt)) ‖ Trunc16(BLAKE3(accountKeyId)) // 32 byte
```

受信者は自分の accountKeyId による hint_i を照合し、対応する tag_i を用いて
sharedKey K を復元します。

---

## 🔗 6. 鍵サービス & 署名 API

| HTTP | URL 例                            | 説明                                                   |
| ---- | --------------------------------- | ------------------------------------------------------ |
| GET  | `…/accountKey?userId={recipient}` | ML-KEM 公開鍵（`crypto:algorithm` 含む、常に最新の鍵） |
| GET  | `…/signingKey`                    | ML-DSA 公開鍵                                          |
| GET  | `…/masterKey`                     | **masterKey 公開鍵**（クライアントで鍵の信頼検証用）   |
| GET  | `…/signatures/{messageId}`        | **Base64URL 署名値**（Content-Type: text/plain）       |

レスポンス例：

```jsonc
// accountKey
{
  "keyId": "https://example.com/keys/kem-111",
  "crypto:algorithm": "mHPKE-Base(ML-KEM-768-mR,HKDF-SHA-512,AES-256-GCM)",
  "key": "Base64(pub)",
  "crypto:masterKeySignature": "Base64URL(sigBytes)"  // 追加: masterKey による署名
}

// signingKey
{
  "keyId": "https://example.com/keys/sigkey-ef56",
  "crypto:algorithm": "ML-DSA-44",
  "key": "Base64(pub)",
  "crypto:masterKeySignature": "Base64URL(sigBytes)"  // 追加
}

// masterKey
{
  "keyId": "https://example.com/keys/master-aaa",
  "crypto:algorithm": "ML-DSA-44",
  "key": "Base64(pub)"
}

// signature (plain text body)
Base64URL(signatureBytes)
```

---

## 🖊️ 7. 署名生成・検証

### 7.1 署名対象範囲

- `ChatMessage` オブジェクト全体（`crypto:signature` フィールド自身を除く）

### 7.2 正規化 (Canonicalization) — JSON Canonicalization Scheme (JCS)

- JSON-LD 展開は行わず、**JSON Canonicalization Scheme (JCS; RFC 8785)**
  のみを適用。
- 正規化手順は Appendix A の A.2 に準拠する。

---

## 7. メンション記法（変更なし）

```
!@<userId>
```

## Appendix A – 署名時 JCS 正規化フロー

この仕様では、署名対象データの正規化に **JSON Canonicalization Scheme (JCS;
RFC 8785)** を採用します。

### A.1 適用範囲

- 正規化対象は、`ChatMessage` オブジェクトから `crypto:signature`
  フィールドを除いた **JSON オブジェクト自身** とします。
- `@context`
  フィールドは、メッセージの送信者と受信者の間で常に同一の文字列表現（例:
  配列内のURLの順序も含む）を用いるものとし、バインド先の意味論的展開は行いません。

### A.2 正規化手順 (JCS)

1. `crypto:signature` フィールドを除去
2. JSON をパースしてネイティブオブジェクト化
3. 各オブジェクトのキーを Unicode コードポイント順にソート
4. 値を最小表現化
   - 文字列：必要最小限のエスケープ、`/` は非エスケープ
   - 数値：不用なゼロや指数表記を除去
   - ブール／null：小文字リテラル
5. 空白や改行を排した最小限の区切り (`:` `,`) で直列化
6. UTF-8 バイト列に変換（署名対象データ **C**）

### A.3 サンプル

以下は、正規化前の `ChatMessage` オブジェクトの例です（`crypto:signature`
フィールドは署名前のため存在しないか、除去済みとします）。このオブジェクトに対して
A.2 の正規化手順を適用すると、署名対象となる UTF-8 バイト列 **C** が得られます。

```jsonc
// 元の ChatMessage（crypto:signature 除去済み）
{
  "@context": "https://example.com/ns/crypto#",
  "specVersion": "1.1",
  "type": "ChatMessage",
  "id": "https://example.com/messages/123",
  "attributedTo": "https://example.com/users/alice",
  "to": [
    "https://example.org/users/bob",
    "https://fedi.example.net/users/carla"
  ],
  "conversation": "https://example.com/conversations/42",
  "inReplyTo": "https://example.com/messages/120",
  "published": "2025-05-03T14:30:00+09:00",
  "crypto:isEncrypted": true,
  "crypto:kemCipherTextUrl": "https://example.com/kemCipherText/123",
  "crypto:cipherText": "Base64URL(iv‖ciphertext‖tag)",
  "attachment": [{
    "type": "ChatAttachment",
    "mediaType": "image/png",
    "url": "https://example.com/media/img1",
    "crypto:encrypted": true,
    "crypto:iv": "Base64URL(ivBytes)",
    "crypto:tag": "Base64URL(tagBytes)"
  }]
}
```

検証側は、受信したメッセージから `crypto:signature`
フィールドを除去した後、上記と同一の手順で署名対象データ **C'**
を再構築し、送信者の公開鍵を用いて署名値 **S** と **C'** を検証します。
