import HeaderMenu from '../islands/HeaderMenu.tsx'

const Contents = () => <>
  <a href="">DM</a>
  <a href="">トーク</a>
  <a href="">About</a>
  <a href="">SNS(開発中)</a>
</>
//メモ: grid-cols-4は4個ずつ並べるという意味。増やすときは数字変える
export default function Header () {
  return <header>
    <div class="w-full flex">
      <div class="pr-3 flex justify-between items-center w-full">
        <div class="block lg:hidden">
          <HeaderMenu>
            <Contents />
          </HeaderMenu>
        </div>
        <div>
          <a class="logo-area flex mb-4"><img src="/logo.png" alt="takoserver logo" class="logo-img" /></a>
        </div>
        <div class="hidden lg:grid grid-cols-4 text-white items-center">
          <Contents />
        </div>
      </div>
    </div>
  </header>
}
