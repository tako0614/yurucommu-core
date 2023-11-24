import { useSignal } from "@preact/signals";
import Button from '../islands/Button.tsx'
export default function Home() {
  const count = useSignal(3);
  return (
    <div><Button script="location.href='https://dev.takoserver.com'" text="ボタン"></Button></div>
  );
}
//