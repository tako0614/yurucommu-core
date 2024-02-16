import HeaderMenu from '../islands/HeaderMenu.tsx'

const Contents = () => <>

</>
const Contents1 = () => <>
<div>ホーム</div>
<div>About</div>
<div>SNS(開発中)</div>
</>
//メモ: grid-cols-4は4個ずつ並べるという意味。増やすときは数字変える
export default function Header () {
  return <header class="p-2.5 bg-black fixed z-[999] w-full py-4 left-0 top-0"> {/* */}
    <div class=" w-full flex">
      <div class="pr-3 flex justify-between items-center w-full">
        <div class="block lg:hidden bg-gray-900">
          <HeaderMenu>
            <Contents />
          </HeaderMenu>
        </div>
        <a class="logo-area flex" href="/"><img src="/logo.webp" alt="takoserver logo" class="w-full h-full" /></a>
        <div class="text-white items-centerhiddenlg:grid ">
        <div class="font0 lg:text-base lg:float-left lg:pr-8"><a href="/">Home</a></div>
        <div class="font0 lg:text-base lg:float-left lg:pr-8"><a href="/about">About</a></div>
        <div class="font0 lg:text-base lg:float-left lg:pr-8"><a href="https://line.me/ti/g2/Q0c8YJlkh5f_hkDuODxp39XF9A7BOCFqezaAHA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default">LINE</a></div>
        <div class="font0 lg:text-base lg:float-left lg:pr-8"><a href="/setting">設定</a></div>
        </div>
      </div>
    </div>
  </header>
}
