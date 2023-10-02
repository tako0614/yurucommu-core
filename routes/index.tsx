import { useSignal } from "@preact/signals";
import Counter from "../islands/Counter.tsx";
import Header from '../components/Header.tsx'

export default function Home() {
  const count = useSignal(3);
  return (
    <>
    <html>
      <head>
        <title>Takoserver project</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <Header />
      <section className="pt-10 pb-10">
        <h1 className="text-5xl text-center text-white">メイン</h1>
        <p className="text-xl text-center text-white">(書いてないだけ)</p>
      </section>
      <footer>
        <p className="text-white text-center">Copyright © 2021-2023 Takoserver All Rights Reserved.</p>
        <p className="text-white text-center"><a href="https://aranpect.com">Aranpect</a></p>
      </footer>
    </html>
    </>
  );
}
