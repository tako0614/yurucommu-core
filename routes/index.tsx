import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
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
          <p class="text-lg"> tako: Technology for All Knowledge Openness</p>
          </div>
        </div>
      <section class="pt-16 pb-10">
        <h1 class="text-5xl text-center text-white">takoserver</h1>
        <p class="text-xl text-center text-white">(書いてないだけ)</p>
        <div class="m-auto w-3/4 text-white">
          <p>
            takoserver
          </p>
        </div>
      </section>
      <Footer />
    </>
  );
}
