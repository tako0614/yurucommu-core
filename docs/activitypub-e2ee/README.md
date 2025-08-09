# e2ee

Coordination of work on end-to-end encryption with ActivityPub.

- [Architectural variations](architectural-variations.md)
- [Integration models](integration-models.md)
- [MLS over ActivityPub](mls.html)

## License

Text and code in this repository is licensed under the
[W3C Software and Document License](https://www.w3.org/copyright/software-license-2023/).

Work by Evan Prodromou and Tom Coates is also licensed under the
[CC+ License](https://summerofprotocols.com/ccplus-license-2023).

## グループAPIの利用方法

ActivityPub 経由でグループを管理するためのエンドポイントを提供します。

- `POST /ap/groups` でグループアクターを作成します。パラメーターは
  `owner`（アカウントID）、`name`、`members`（メンバーの配列）です。
- `GET /ap/groups/:id` で作成したグループアクターを取得できます。
- メンバーの追加や削除は `POST /ap/groups/:id/members` に ActivityPub の `Add` /
  `Remove` アクティビティ、または MLS `Proposal`
  を送信して行います。変更は連合先にも配信されます。

従来の `/accounts/:id/groups` エンドポイントは互換レイヤーとして残されており、
新しい API へリダイレクトされます。
