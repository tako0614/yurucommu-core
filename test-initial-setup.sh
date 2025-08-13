#!/bin/bash

# 初期設定状態を確認するテストスクリプト

echo "=== 初期設定状態確認テスト ==="
echo ""

# テスト用のサーバーURL（ローカル環境を想定）
SERVER_URL="http://localhost:8000"

echo "1. /api/setup/status エンドポイントの確認（認証なし）"
echo "   リクエスト: GET $SERVER_URL/api/setup/status"
curl -s -w "\n   HTTPステータス: %{http_code}\n" \
     -H "Content-Type: application/json" \
     "$SERVER_URL/api/setup/status" | jq '.'

echo ""
echo "2. 初期設定前の状態で /api/setup へのPOSTテスト"
echo "   リクエスト: POST $SERVER_URL/api/setup"
echo "   ※ hashedPasswordが設定されていない場合は認証不要で初期設定可能"

echo ""
echo "=== テスト完了 ==="
echo ""
echo "期待される動作:"
echo "- /api/setup/status は認証なしでアクセス可能"
echo "- configured: false が返される（初期設定前の場合）"
echo "- クライアント側で初期設定画面が表示される"