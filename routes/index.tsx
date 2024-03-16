import Footer from '../components/Footer.tsx'
import Welcom from "../components/Welcome.tsx";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const key = env["rechapcha_site_key"];
export default function Home() {
  const url = `https://www.google.com/recaptcha/api.js?render=${key}`
  return (
    <>
      <head>
        <title>tako's | takos.jp</title>
        <link rel="stylesheet" href="/style.css"></link>
        <meta name="description" content="日本産オープンソース分散型チャットアプリ「tako's」" />
        <script src={url}></script>
        <script src="./rechapcha.js"></script>
      </head>
      <Welcom key={key}/>
      <Footer></Footer>
    </>
  );
}
