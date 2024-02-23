import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import UnderMenu from '../components/UnderMenu.tsx'

function Name({developerss}: {developerss: any}) {


  return (
    <>
    <div class="flex gap-4 items-start">
      <img
        src={developerss.src}
        width="120"
        height="120"
        alt="Portrait of the team member"
        class="rounded-full overflow-hidden object-cover w-120 h-120 aspect-square"
      />
      <div class="grid gap-2">
        <div class="space-y-2">
          <h2 class="text-2xl font-bold">{developerss.name}</h2>
          <p class="text-gray-500 dark:text-gray-400">{developerss.position}</p>
        </div>
        <div class="space-y-4">
          <p class="text-lg leading-loose">
            {developerss.body}
          </p>
        </div>
      </div>
    </div>
     </>
  )
  }
  const developers = {
    tako: {
      src: "/logo-mine.jpg",
      name: "たこ",
      position: "takoserver,takotopia leader",
      body: "takoserverのリーダー!!マイクラサーバーや分散型チャットサービス「tako's」など様々なサービスを展開してます"
    },
    minai: {
      src: "/379213.jpg",
      name: "371tti",
      position: "tako's developer, takoserver member",
      body: "しがないタコのコードのダメ出しをするうっさいやつ。姉妹？SNSをつくっている。なおjsが苦手"
    },
    nasuki: {
      src: "/natu.jpg",
      name: "natsuki",
      position: "takoserver member",
      body: "ひまじんなつき"
    }
  }
export default function Home() {
  const count = useSignal(3);
  return (
    <>
      <head>
        <title>takoserver project</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <Header />
        <div class="bg-[url('./main-bg.webp')] bg-center bg-cover relative w-full min-h-screen">
          <div  class="lg:absolute lg:top-[calc(40%_-_0.5em)] lg:w-full lg:text-center lg:text-white lg:m-0 absolute top-[calc(40%_-_0.5em)] w-full text-center text-white m-0">
          <h1 class="full-title text-[3.5rem] lg:text-[70px]">tako's</h1>
          <p class="text-lg">Technology for All Knowledge & Octopus</p>
          </div>
        </div>
        <div class="w-2/3 flex flex-col h-screen m-auto text-white">
        <main class="flex-1 overflow-y-auto py-6 pt-20">
              <h1 class="text-center pb-5 text-3xl lg:text-5xl">tako's developers</h1>
              <div class="grid gap-4 md:gap-6">
              <Name developerss={developers.tako}></Name>
              <div class="border-t w-full"></div>
              <Name developerss={developers.minai}></Name>
              <div class="border-t w-full"></div>
              <Name developerss={developers.nasuki}></Name>
              </div>
        </main>
        </div>
      <section class="pt-16 pb-10">
        <h1 class="text-5xl text-center text-white">takoserver</h1>
        <div class="m-auto w-3/4 text-white md:flex">
          <div class="md:w-1/2">
          <img class="m-full" src="logo-mine.jpg" alt="キャラクター" />
          <p class="text-l text-center text-white">takoserver公式マスコット</p>
          </div>
          <div class="md:w-1/2 md:ml-8">
            <h1 class="text-3xl font-semibold pb-4">日本産オープンソース分散型チャットアプリ「tako's」</h1>
            <h2 class="text-2xl">tako'sのコンセプト！</h2>
          <p>
          ・LINEの無駄な機能を排除して本当に必要な機能のみ実装

          ・分散型だからユーザーの意見が反映されたサーバーに登録・移行が可能<br />

          ・別のサーバー同士で友達になれる<br />

          ・オープンチャットの代替サービスとして日本のネット文化の原点とも言える2chのような掲示板機能で不特定多数の人と交流することができます。<br />

          ※現時点での目標であり、より良いサービスにするために増えたり減ったりします。<br />
          </p>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
