import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
export default function HeaderMenu ({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  
  return <>
    <div>
      <button>🍔</button>
    </div>
    <div class={`
      fixed top-0 left-0 w-screen h-screen bg-white border p-3
      duration-100
      ${isOpenMenu ? 'translate-x-0' : 'translate-x-full'}`}
      >
      { children }
    </div>
  </>
}
