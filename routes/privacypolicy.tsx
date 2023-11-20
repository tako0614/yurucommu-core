// routes/_app.tsx
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
function Title({ children }: Props) {
  return (
    <h2 class="text-3xl text-left text-white font-size mt-16 border-b-2 border-indigo-500">{ children }</h2>
  );
}
function Value({ children }: Props) {
  return (
    <div class="ml-5">
    { children }
    </div>
  );
}
export default function privacy() {
    return (
      <html>
        <head>
          <title>takoserver</title>
          <link rel="stylesheet" href="/style.css"></link>
        </head>
        <body>
          <Header />
          <div class="p-16 w-3/4 m-auto">
          <h1 class="text-5xl text-center text-white">プライバシーポリシー</h1>
          <p class="text-white">takoserverは，ユーザーの個人情報について以下のとおりプライバシーポリシー（以下、「本ポリシー」という。）を定めます。本ポリシーは、当社がどのような個人情報を取得し、どのように利用・共有するか、ユーザーがどのようにご自身の個人情報を管理できるかをご説明するものです。</p>
          <Title>1.事業者情報</Title>
          <Value>
          <p class="text-white">事業者名：takoserver</p>
          <p class="text-white">運営責任者：冨山翔太</p>
          <p class="text-white">メールアドレス：shoutatomiyama0614@gmail.com</p>
          </Value>
          <Title>2.個人情報の取得</Title>
          <Value>
            <p class="text-white">当サイトは、ユーザーがアカウントを使用するとき、氏名・生年月日・住所・電話番号・メールアドレス・クレジットカード番号など個人を特定できる情報を取得させていただく場合があります。
            お問い合わせフォームの送信時にはメールアドレスを取得させていただきます。</p>
          </Value>
          </div>
          <Footer />
        </body>
      </html>
    );
}