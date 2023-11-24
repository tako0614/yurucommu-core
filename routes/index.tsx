import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import UnderMenu from '../components/UnderMenu.tsx'
export default function Home() {
  const count = useSignal(3);
  return (
    <>
      <head>
        <title>takoserver project</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <Header />
        <div class="full">
          <div  class="full-title">
          <h1>takoserver project</h1>
          <p class="text-lg">Technology for All Knowledge & Octopus</p>
          </div>
        </div>
      <section class="pt-16 pb-10">
        <h1 class="text-5xl text-center text-white">takoserver</h1>
        <div class="m-auto w-3/4 text-white md:flex">
          <div class="md:w-1/2">
          <img class="m-full" src="logo-mine.jpg" alt="キャラクター" />
          <p class="text-l text-center text-white">takoserver公式マスコット</p>
          </div>
          <div class="md:w-1/2 md:ml-8">
          <p>
          ※TAKOserver NEXUSとは無関係です。<br />
          ※takoserverにもマインクラフトサーバーはありましたが現在は停止中です<br />
          takoserverは(LINE+twitter+instagram)÷4みたいな分散型SNSを作ることを目指しています<br />
          最近親にルーターを侵略されたせいでvpn経由で公開しております<br />
          </p>
          </div>
        </div>
      </section>
      <UnderMenu />
      <Footer />
    </>
  );
}
