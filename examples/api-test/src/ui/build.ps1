# Takos API Test UI ビルドスクリプト
Write-Host "Takos API Test Extension UI をビルド中..." -ForegroundColor Green

# 依存関係のインストールチェック
if (!(Test-Path "node_modules")) {
    Write-Host "依存関係をインストールしています..." -ForegroundColor Yellow
    npm install
}

# 既存のdistディレクトリを削除
if (Test-Path "dist") {
    Write-Host "既存のdistディレクトリを削除中..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "dist"
}

# ビルドの実行
Write-Host "ビルドを実行中..." -ForegroundColor Blue
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "ビルドが正常に完了しました!" -ForegroundColor Green
    Write-Host "ビルド成果物は dist/ ディレクトリにあります" -ForegroundColor Green
} else {
    Write-Host "ビルドでエラーが発生しました" -ForegroundColor Red
    exit 1
}
