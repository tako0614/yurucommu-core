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
      <Header />
      <Welcom />
    </>
  );
}
