import HeaderMenu from '../islands/HeaderMenu.tsx'

const Contents = () => <>
  <p><a href="/">Home</a></p>
  <p><a href="/about">About</a></p>
  <p><a href="https://line.me/ti/g2/Q0c8YJlkh5f_hkDuODxp39XF9A7BOCFqezaAHA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default">LINE</a></p>
  <p><a href="/setting">設定</a></p>
</>
//メモ: grid-cols-4は4個ずつ並べるという意味。増やすときは数字変える
export default function Header () {
  return <header>
    <div class="w-full flex">
      <div class="pr-3 flex justify-between items-center w-full">
        <div class="block lg:hidden bg-gray-900">
          <HeaderMenu>
            <Contents />
          </HeaderMenu>
        </div>
        <div>
          <a class="logo-area flex mb-4" href="/"><img src="/logo.png" alt="takoserver logo" class="logo-img" /></a>
        </div>
        <div class="hidden lg:grid grid-cols-4 text-white items-center">
          <Contents />
        </div>
      </div>
    </div>
  </header>
}
