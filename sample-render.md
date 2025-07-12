以下では **ActivityPub の “ツイート” (= `Note` オブジェクト) をタイムラインに描画する** とき、代表的な実装（Mastodon 系・Pleroma 系）や一般的な Web セキュリティの慣習を踏まえつつ、**コンテンツの正規化パイプライン** を段階別に整理します。
（※“ツイート”と書きますが ActivityPub 上では `Note` です）

---

## 1. 受信直後: JSON-LD オブジェクトの前処理

| ステップ                | 処理                                                                       | ねらい                          |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| **1-A 言語ネゴ**        | `contentMap` があれば `Accept-Language` と照合し最適なキーを選択。無ければ `content` をそのまま使う。 | マルチリンガル投稿の適切な表示              |
| **1-B Unicode 正規化** | `content` を **NFC** で正規化し、ゼロ幅・BOM 文字（`\u200B-\u200D\uFEFF` など）を除去。       | 絵文字・合成文字の分割バグ防止、ハッシュタグ照合の安定化 |
| **1-C 改行・空白整理**     | CRLF→LF、連続空白→1 個など。改行は後段で `<br>` に変換。                                    | 不要な余白削減、正規形保存                |

> Mastodon もゼロ幅文字を除去した上で URL 抽出を行っています。([GitHub][1])

---

## 2. HTML サニタイズ

1. **パーサ**

   * HTML 文字列としてパース（`DOMParser` / `jsdom` / Nokogiri 等）。
2. **許可タグ・属性だけ残す**

   * Mastodon 4.2 では `<p><br><a><span>` に加え `<em><strong><pre><code><ul><li>` …等が許可されています。([Mastodon Docs][2])
   * Pleroma 系は `fast_sanitize` を使い似たホワイトリストを持ちます。([GitLab][3])
3. **リンク安全化**

   * `target="_blank" rel="noopener noreferrer"` を強制。
   * プロトコルは `http/https/dat/ipfs/gemini/...` など限定（Mastodon の既定一覧参照）。([GitHub][1])
4. **不許可要素のダウングレード**

   * `<h1-h6>` → `<strong>`、リスト → `<p>…<br>` へ変換など。([Mastodon Docs][2])

> **クライアント側で行う場合**、標準の *HTML Sanitizer API*（Chrome 121+）を使うと実装が簡潔です。([MDN Web Docs][4])

---

## 3. リンク化・メンション・ハッシュタグ解析

| 項目         | 処理ポイント                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **URL**    | 文字列内の裸 URL を正規表現で検出し `<a>` へ。末尾のかっこ・句読点を除外するロジックが必須（例: `)` `、` が混ざる日本語文）。                                                                                           |
| **メンション**  | `tag[].type="Mention"` を優先。見つからない場合は `@user@host` パターンをローカル DB と突合してリンク化。                                                                                           |
| **ハッシュタグ** | `tag[].type="Hashtag"` を使う。文字列表記は正規化済み NFC を保管し、検索インデックスは `toLocaleLowerCase('en-US-u-kk-true')` などで大小・合字差を吸収。<br>Unicode 正規化漏れは “#ć → #c” 問題の原因になります。([GitHub][5]) |

---

## 4. 絵文字・カスタム emoji

* `tag[].type="Emoji"` を `<img class="emoji">` に置換。([Mastodon Docs][2])
* テキストに残った `:shortcode:` はローカル絵文字辞書で変換。
* 代替テキスト (alt) を必ず入れてアクセシビリティ確保。

---

## 5. Content Warning（CW）とセンシティブ

* `as:sensitive=true` → 画像サムネイルと本文をデフォルト非表示。
* `summary` があれば CW 見出しとしてボタン UI を生成。

---

## 6. 添付メディアの描画

| フィールド                     | 備考                                                 |
| ------------------------- | -------------------------------------------------- |
| `attachment[].url`        | メディア URL。MediaType でアイコンや `<video>` `<audio>` を分岐。 |
| `blurhash` / `focalPoint` | プレースホルダーとクロップ位置に利用。([Mastodon Docs][2])            |
| `summary`                 | alt テキストとして表示。                                     |

---

## 7. ストレージ／検索用の **内部正規形**

1. **HTML→PlainText 抜粋**（検索インデックス用）

   * `<br>` → `\n`, `<p>` → `\n\n` など。
2. **下記を別カラムに分離**

   * メンション ID 一覧
   * ハッシュタグ（正規化済み）
   * 外部 URL 一覧（OGP 取得キュー用）

---

## 8. 実装サンプル（Node.js + TypeScript）

```ts
import { parseHTML, sanitizeHTML } from "html-sanitizer"; // HTML Sanitizer API polyfill
import linkifyUrls from "linkify-urls";
import { preprocess } from "./unicode";

export function renderNote(raw: string): string {
  const nfc = preprocess(raw);          // 1-B
  const linked = linkifyUrls(nfc, { attributes: { rel: "noopener noreferrer", target: "_blank" }});
  const sanitized = sanitizeHTML(linked, {
    allowElements: ["p","br","a","span","em","strong","code","ul","ol","li"],
    allowAttributes: { "a": ["href","rel","class","target"], "span": ["class"] },
    dropElements: ["script","style","iframe"],
    allowCustomProtocols: ["dat","ipfs","gemini"]
  });
  return sanitized;
}
```

---

## 9. 実装間の差異と注意点

| 実装                 | 特徴                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **Mastodon**       | Ruby + `sanitize-ruby` 拡張で細かい変換ルール。許可タグは上記。([Mastodon Docs][2])                                     |
| **Pleroma/Akkoma** | Elixir + `fast_sanitize`。許可タグは比較的緩いが inline-style は禁止。([GitLab][3])                                 |
| **Misskey**        | 独自の BBCode 風マークアップを HTML に変換後、さらにサニタイズする二段構え。                                                       |
| **独自実装時の落とし穴**     | *URL が連続*・*Unicode 合字*・*RTL 制御文字* でリンク切れ/XSS が起きやすい。ブラウザ組込の Sanitizer API か well-tested ライブラリ利用が安全。 |

---

### まとめ

1. **NFC + ゼロ幅除去** → 可視テキスト同士の衝突を防ぐ
2. **HTML サニタイズ** → 許可タグ/属性ホワイトリスト方式
3. **URL・メンション・タグのリンク化** → 正規表現＋DB 照合
4. **添付・CW・emoji** → ActivityStreams の `tag` / `attachment` 情報を優先
5. **内部正規形を保存** → 検索・フィルタリングを高速化

これらをパイプライン化することで、ローカル投稿・リモート投稿どちらでも **XSS 耐性** と **表示の一貫性** を両立できます。

[1]: https://raw.githubusercontent.com/mastodon/mastodon/main/lib/sanitize_ext/sanitize_config.rb "raw.githubusercontent.com"
[2]: https://docs.joinmastodon.org/spec/activitypub/ "ActivityPub - Mastodon documentation"
[3]: https://git.pleroma.social/pleroma/elixir-libraries/fast_sanitize?utm_source=chatgpt.com "master · Pleroma / Elixir libraries / fast_sanitize · GitLab"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API?utm_source=chatgpt.com "HTML Sanitizer API - MDN Web Docs"
[5]: https://github.com/mastodon/mastodon/issues/25451?utm_source=chatgpt.com "Some unicode hashtags federate badly · Issue #25451 - GitHub"
