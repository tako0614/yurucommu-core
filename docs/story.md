Story オブジェクトの強化: 複数のメディア・テキストと位置情報への対応
前回の設計では画像または動画ひとつとテキスト、背景色などを扱うシンプルな Story オブジェクトを提案しました。しかし、Instagram のストーリーのように複数の写真・動画・テキストを組み合わせ、各要素の表示位置やタイミングを指定できるようにすると表現力が格段に向上します。本節ではこの拡張に対応するための StoryElement と位置情報プロパティを追加した設計を示します。

1. 拡張の背景と必要性
利用者はストーリー上にスタンプ・テキスト・複数の画像や動画を重ね、サイズや位置を調整することができます。単一メディアとテキストだけでは表現が乏しく、同じ場所にしかテキストを配置できなければ「ダサい」と感じられるでしょう。そこで、ストーリー内に複数の要素を配置し、それぞれの位置・サイズ・表示時間を記述できるようにします。

2. StoryElement と位置プロパティの定義
2.1 拡張コンテキスト
Story コンテキストに StoryElement という新しいオブジェクト型を追加し、複数要素を格納する elements プロパティおよび位置情報を表すプロパティを定義します。以下の拡張コンテキストでは、各要素の位置を 0〜1 の相対座標で指定します。また要素の表示開始時間 (start) と表示時間 (duration) を秒単位で記述できるようにしています。

json
コピーする
編集する
{
  "@context": {
    "sto": "https://takos.dev/ns/story#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "Story": { "@id": "sto:Story", "@type": "@id" },
    "StoryElement": { "@id": "sto:StoryElement", "@type": "@id" },
    "elements": { "@id": "sto:elements", "@type": "@set" },
    "mediaUrl": { "@id": "sto:mediaUrl", "@type": "@id" },
    "mediaType": { "@id": "sto:mediaType", "@type": "xsd:string" },
    "expiresAt": { "@id": "sto:expiresAt", "@type": "xsd:dateTime" },
    "backgroundColor": { "@id": "sto:backgroundColor", "@type": "xsd:string" },
    "textColor": { "@id": "sto:textColor", "@type": "xsd:string" },
    "viewCount": { "@id": "sto:viewCount", "@type": "xsd:integer" },
    "x": { "@id": "sto:x", "@type": "xsd:double" },
    "y": { "@id": "sto:y", "@type": "xsd:double" },
    "width": { "@id": "sto:width", "@type": "xsd:double" },
    "height": { "@id": "sto:height", "@type": "xsd:double" },
    "start": { "@id": "sto:start", "@type": "xsd:double" },
    "duration": { "@id": "sto:duration", "@type": "xsd:double" },
    "text": { "@id": "sto:text", "@type": "xsd:string" },
    "color": { "@id": "sto:color", "@type": "xsd:string" }
  }
}
2.2 Story オブジェクトの例
以下は、2 枚の写真とテキストスタンプを含むストーリーの例です。elements 配列の各要素は type プロパティで Image・Video・Text のいずれかを示し、位置・サイズ・表示時間を個別に指定します。x と y は 0〜1 の相対座標で、左上が (0,0)、右下が (1,1) です。動画要素の場合は mediaUrl と mediaType を指定し、テキスト要素の場合は text と color だけを指定します。

json
コピーする
編集する
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://github.com/takoserver/takos/blob/master/docs/story.md"
  ],
  "id": "https://example.com/story/456",
  "type": ["Story", "Image", "Object"],
  "attributedTo": "https://example.com/users/bob",
  "published": "2025-07-29T12:00:00Z",
  "expiresAt": "2025-07-30T12:00:00Z",
  "elements": [
    {
      "type": ["Image", "Object"],
      "mediaUrl": "https://example.com/media/photo1.jpg",
      "mediaType": "image/jpeg",
      "x": 0.0,
      "y": 0.0,
      "width": 1.0,
      "height": 0.5,
      "start": 0.0,
      "duration": 5.0
    },
    {
      "type": ["Image", "Object"],
      "mediaUrl": "https://example.com/media/photo2.jpg",
      "mediaType": "image/jpeg",
      "x": 0.0,
      "y": 0.5,
      "width": 1.0,
      "height": 0.5,
      "start": 5.0,
      "duration": 5.0
    },
    {
      "type": ["Text", "Note", "Object"],
      "text": "旅行楽しい！",
      "color": "#ff00ff",
      "x": 0.1,
      "y": 0.1,
      "width": 0.8,
      "height": 0.2,
      "start": 0.0,
      "duration": 10.0
    }
  ],
  "viewCount": 0
}
この例では、2 枚の写真が順番に表示され、テキストは全体表示中に重なって表示されます。要素ごとに表示時間や位置を変えられるため、柔軟なレイアウトが可能です。

3. Takos への実装のポイント
データ構造の変更 – Story オブジェクトに elements 配列を追加し、それぞれの要素を type・mediaUrl・text・位置情報とともに保存します。既存の content・mediaUrl・mediaType フィールドは廃止し、elements に統一することを推奨します。移行期は elements から mediaUrl などを生成する処理を入れても良いでしょう。

JSON‑LD コンテキストの更新 – 新しいコンテキスト（例: story-context-multi.jsonld）を Takos サーバーに追加し、@context 配列で参照できるようにします。要素の type は ActivityStreams の Image や Video、Text にフォールバックさせることで互換性を保ちます
w3.org
。

クライアントレンダリング – フロントエンドでは elements 配列を順に読み込み、start と duration に基づいてタイムラインを制御します。x、y、width、height を使ってキャンバス上に要素を配置します。CSS のフレックスやアブソリュートポジショニングを用いて実装できます。

バリデーション – x、y、width、height は 0〜1 の範囲、duration は正の数という制約をサーバー側でチェックし、不正な値が保存されないようにします。

後方互換性 – 現在の簡易な Story オブジェクトとの互換性を保つため、elements が存在しない場合は従来の mediaUrl と content を1要素のストーリーとして解釈する処理をクライアント・サーバの双方に実装しておくと安心です。

4. おわりに
複数の写真・動画・テキストを任意の位置とタイミングで表示できるようにすることで、ストーリー表現の幅が大きく広がります。今回追加した StoryElement タイプと位置情報プロパティは ActivityStreams の拡張として定義されており、@context を通じてプロパティの意味とデータ型を他の実装に伝えます。Takos への導入ではサーバー・データモデルの変更とフロントエンドのレンダリング対応が必要ですが、ユーザー体験向上に大きく寄与するでしょう。