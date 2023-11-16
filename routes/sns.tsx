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
        <div>
            
        </div>
      <Footer />
    </>
  );
}
