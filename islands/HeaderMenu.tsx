import { JSX } from "preact";
import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
export default function HeaderMenu ({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  
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
        { children }
      </div>
    </div>
  </>
}
