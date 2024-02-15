// routes/_app.tsx
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
function Title({ children }: any) {
  return (
    <h2 class="text-3xl text-left text-white font-size mt-14 border-b-2 border-indigo-500">{ children }</h2>
  );
}
function Value({ children }: any) {
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
        </head>
          <Header />
          <div class="p-16 lg:w-2/3 m-auto">
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
          <Title>3.個人情報の利用目的</Title>
          <Value>
            <p class="text-white">・取得した閲覧履歴等の情報を分析し、本サイトにおいてユーザーに適したサービスを開発するために利用されます。</p>
            <p class="text-white">・ユーザーが利用しているサービスの新機能や更新、利用規約改定などをメール送付によりご案内します</p>
            <p class="text-white">・ユーザーからのお問い合わせに回答するため</p>
            <p class="text-white">・利用規約に違反したユーザーの特定、その他不正不当な目的でサービスを利用したユーザーの特定をし利用をお断りするため</p>
            <p class="text-white">個人情報の利用目的は変更前後の関連性について合理性が認められる場合に限って変更するものとします</p>
            <p class="text-white">個人情報の利用目的について変更を行った際は変更後の目的についてユーザーに通知し当サイトにも公表するものとします。</p>
          </Value>
          <Title>4.個人データを安全に管理するための措置</Title>
          <Value>
            <p class="text-white">当サイトは、個人情報を正確かつ最新の内容に保つように努め、不正なアクセス・改ざん・漏えい・滅失および毀損から保護することに努めます。また現場での管理についても定期的に点検を行います</p>
          </Value>
          <Title>5.個人データの第三者提供について</Title>
          <Value>
            <p class="text-white">当サイトは以下の場合を除き、同意を得ないで第三者に個人情報を提供することは致しません。</p>
            <p class="text-white">法令に基づく場合</p>
            <p class="text-white">人の生命、身体又は財産の保護のために必要がある場合であって、本人の同意を得ることが困難であるとき</p>
            <p class="text-white">公衆衛生の向上又は児童の健全な育成の推進のために特に必要がある場合であって、本人の同意を得ることが困難であるとき</p>
            <p class="text-white">国の機関若しくは地方公共団体又はその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、本人の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがあるとき</p>
          </Value>
          <Title>6.匿名加工情報に関する取扱い</Title>
          <Value>
            <p class="text-white">当サイトは、匿名加工情報（特定の個人を識別できないよう加工した個人情報であって、復元ができないようにしたもの）を作成する場合、以下の対応を行う場合があります。</p>
            <p class="text-white">法令で定める基準に従い適正な加工を施す</p>
            <p class="text-white">法令で定める基準に従い安全管理措置を講じる</p>
            <p class="text-white">匿名加工情報に含まれる個人に関する情報の項目を公表する</p>
            <p class="text-white">作成元となった個人情報の本人を識別するため、他の情報と照合すること</p>
          </Value>
          <Title>7.個人情報取扱いに関する相談や苦情の連絡先</Title>
          <Value>
            <p class="text-white">当サイトの個人情報の取扱いに関するご質問やご不明点、苦情、その他のお問い合わせはお問い合わせフォームよりご連絡ください。</p>
          </Value>
          <Title>8.SSL（Secure Socket Layer）について</Title>
          <Value>
            <p class="text-white">当サイトはSSLに対応しており、WebブラウザとWebサーバーとの通信を暗号化しています。ユーザーが入力する氏名や住所、電話番号などの個人情報は自動的に暗号化されます。</p>
          </Value>
          <Title>9.cookieについて</Title>
          <Value>
            <p class="text-white">cookieとは、WebサーバーからWebブラウザに送信されるデータのことです。Webサーバーがcookieを参照することでユーザーのパソコンを識別でき、効率的に当社Webサイトを利用することができます。当社Webサイトがcookieとして送るファイルは、個人を特定するような情報を含んでおりません。お使いのWebブラウザの設定により、cookieを無効にすることも可能ですが無効にすると当サイトのアカウントを使った機能が使えなくなります。</p>
          </Value>
          <Title>10.プライバシーポリシーの制定日及び改定日</Title>
          <Value>
            <p class="text-white">制定: 2023/08/03</p>
          </Value>
          <Title>11.免責事項</Title>
          <Value>
            <p class="text-white">当社Webサイトに掲載されている情報の正確さには万全を期していますが、利用者が当社Webサイトの情報を用いて行う一切の行為に関して、当サイトは一切の責任を負わないものとします。</p>
            <p class="text-white">当サイトは、利用者が当Webサイトを利用したことにより生じた利用者の損害及び利用者が第三者に与えた損害に関して、当サイトに重大な欠陥がある場合を除き一切の責任を負わないものとします。</p>
          </Value>
          <Title>12.著作権・肖像権</Title>
          <Value>
            <p class="text-white">当Webサイト内の文章や画像、すべてのコンテンツは著作権・肖像権等により保護されており、無断での使用や転用は禁止されています。</p>
          </Value>
          </div>
          <Footer />
      </html>
    );
}