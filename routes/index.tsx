import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import UnderMenu from '../components/UnderMenu.tsx'
import Welcom from "../components/Welcome.tsx";
export default function Home() {
  const count = useSignal(3);
  return (
    <>
      <head>
        <title>tako's | takos.jp</title>
        <link rel="stylesheet" href="/style.css"></link>
        <meta name="description" content="日本産オープンソース分散型チャットアプリ「tako's」" />
      </head>
      {/*<Header />*/}
      <div class="absolute top-0 right-0 flex items-center justify-center w-16 overflow-hidden h-16">
        <a href="https://github.com/takoserver/takos">
      <img
        src="/github.svg"
        alt="Insert Image"
        width="30"
        height="30"
        class="w-12 h-12 flex items-center justify-center bg-black"
        //style="aspect-ratio: 24 / 24; object-fit: cover;"
      />
      </a>
    </div>
      <Welcom />
      <Footer></Footer>
    </>
  );
}
