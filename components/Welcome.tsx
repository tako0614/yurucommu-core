import RegisterForm from "../islands/RegisterForm.tsx"
export default function Welcome () {
  return (
    <>
<div>
<div class="min-h-screen bg-black flex flex-row justify-center items-center text-white">
  <div class="flex flex-col justify-center items-center space-y-6 md:w-1/2 w-0">
    <div>
      <img src="./logo2.png" alt="logo" class="w-full"/>
    </div>
  </div>
  <div class="flex flex-col justify-start items-center md:items-start space-y-3 md:w-1/2 w-full">
    <div class="text-center md:text-left">
      <h1 class="text-[52px] font-bold mb-3">tako's</h1>
      <p class="text-xl lg:text-2xl mb-8">Next generation decentralized chat service</p>
<p class="text-lg">現在開発中</p>
<p class="text-lg mb-8">開発者募集中です！公式オープンチャットから</p>
    </div>
    <div class="flex flex-col space-y-3 mb-8">
      <RegisterForm tako="instans" color="hover:bg-primary/90 h-11 px-4 py-2 bg-white text-black w-72 " text="インスタンス作成"></RegisterForm>
      <RegisterForm tako="register" color="hover:bg-accent hover:text-accent-foreground h-11 px-4 py-2 bg-black border border-white text-white w-72" text="このサーバーに登録"></RegisterForm>
      <RegisterForm tako="login" color="hover:bg-primary/90 h-11 px-4 py-2 bg-blue-600 text-white w-72 " text="ログイン"></RegisterForm>
    </div>
    <div class="text-center md:text-left text-sm mb-8">
      <p>
        アカウントを登録することにより、利用規約とプライバシーポリシー（Cookieの使用を含む）に同意したことになります。
      </p>
    </div>
    <div class="text-center md:text-left text-sm mb-8">
      <p class="underline">アカウントをお持ちの場合</p>
    </div>
  </div>
  </div>
  <div class="text-xs text-gray-400 absolute bottom-0 left-0 right-0 flex justify-center p-4">
    <p>
      基本情報 マルチプラットフォーム ヘルプセンター 利用規約 プライバシーポリシー Cookieのポリシー アクセシビリティ
      広告情報 ブログ ステータス 法的情報 マーケティング パートナーシップ デベロッパーズ ポータル
      プロフィールディレクトリ 設定 © 2024 Tomiyama Shota
    </p>
  </div>
</div>
    </>
  )
}