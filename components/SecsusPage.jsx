export function SecsusPage() {
  return (
    <div
      className="text-white"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <div>
        <h1 className="text-5xl">
          登録が完了しました5秒後にリダイレクトされます
        </h1>
        <div className="text-2xl">
          リダイレクトされない場合は<a href="./login">
            こちら
          </a>をクリックしてください
        </div>
      </div>
    </div>
  )
}
