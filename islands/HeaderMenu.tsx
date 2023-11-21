import { JSX } from "preact";
import { useState } from 'preact/hooks'

export interface Props {
  children: JSX.Element
}
const class1 = "block w-full text-base box-border text-color-white no-underline pt-2.5 pr-4 text-center pb-0 pl-4 font-bold"
const Menu1 = (
  <div class="ml-5 divide-y border-gray-500 text-center">
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
    <div class="">
      <img onClick={() => setIsOpen(true)} src="./icons/menu.png" class="text-4xl text-white w-7 pt-1" />
    </div>
    <div class={`
      fixed top-0 left-0 w-screen h-screen bg-gray-900 p-3
      duration-100 text-white 
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
      <div>
        <img src="./icons/batu.png" class="text-3xl w-7" onClick={() => setIsOpen(false)} />
      </div>
      <ul class="divide-y border-gray-500 m-auto w-4/5">
        <li><a href="/"class={class1}>HOME</a></li>
        <li><a href="/serach"class={class1}>検索</a></li>
        <li><a href="/talk"class={class1}>トーク</a></li>
        <li><a class={class1}>ダイレクトメッセージ</a></li>
        <li><a class={class1}>通知</a></li>
        <li><a class={class1}>プロフィール</a></li>
        <li><a href="/setting"class={class1}>設定</a></li>
        <li><a href="/login"class={class1}>ログイン</a></li>
        <li><a href="/register" class={class1}>新規登録</a></li>
        <li><a href="https://line.me/ti/g2/Q0c8YJlkh5f_hkDuODxp39XF9A7BOCFqezaAHA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default" class={class1}>公式オープンチャット</a></li>
        <li><a class={class1}></a></li>
      </ul>
      {/*
      <div class="divide-y border-gray-500">
      <div class="my-2">
      <div class="divide-y border-gray-500 text-xl">
      <p class="text-center"><a href="">DM</a></p>
      <p class="text-center"><a href="">トーク</a></p>
      <p class="text-center"><a href="">About</a></p>
      <p class="text-center"><a href="">SNS(開発中)</a></p>
      <div 
        class="flex text-xl text-center"
        onClick={() => setIsOpenMenu1(!isOpenMenu1)}
        >
          <p class="m-auto">コミュニティー</p>
          <p class="ml-10 text-lg">{isOpenMenu1 ? "∧" : "∨"}</p>
        </div>
        {isOpenMenu1 ? Menu1 : ""} 
      </div>
      </div>
      </div>*/}
    </div>
  </>
}
