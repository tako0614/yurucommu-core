import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
export default function HeaderMenu ({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  
  return <>
    <div>
      <button onClick={() => setIsOpen(true)}>🍔</button>
    </div>
    <div class={`
      fixed top-0 left-0 w-screen h-screen bg-white border p-3
      duration-100
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <div>
        <button class="text-xl" onClick={() => setIsOpen(false)}>
          x
        </button>
      </div>
      <div class="my-2">
        { children }
      </div>
    </div>
  </>
}
