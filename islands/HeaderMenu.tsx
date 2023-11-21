import { JSX } from "preact";
import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
const Menu1 = (
  <div>
    <p><a href="">LINE</a></p>
    <p><a href="">discord</a></p>
    <p><a href="">twitter(X)</a></p>
    <p><a href="">instagram</a></p>
  </div>
)
export default function HeaderMenu ({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isOpenMenu1, setIsOpenMenu1] = useState(false)
  return <>
    <div>
      <img onClick={() => setIsOpen(true)} src="./icons/menu.png" class="text-4xl text-white w-7 pt-1" />
    </div>
    <div class={`
      fixed top-0 left-0 w-screen h-screen bg-white border p-3
      duration-100
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <div>
        <img src="./icons/batu.png" class="text-3xl w-7" onClick={() => setIsOpen(false)} />
      </div>
      <div class="my-2">
      <p
      class="text-2xl"
      onClick={() => setIsOpenMenu1(!isOpenMenu1)}
      >コミュニティー</p>
      {isOpenMenu1 ? Menu1 : ""}
      <p><a href="">DM</a></p>
      <p><a href="">トーク</a></p>
      <p><a href="">About</a></p>
      <p><a href="">SNS(開発中)</a></p>
      </div>
    </div>
  </>
}
