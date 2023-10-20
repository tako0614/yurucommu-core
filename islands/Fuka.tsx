import { JSX } from "preact";
import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
export default function HeaderMenu ({ children }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  
  return
}
