import HeaderMenu from '../islands/HeaderMenu.tsx'

const Contents = () => <>
  <div>ホーム</div>
  <div>About</div>
  <div>SNS(開発中)</div>
</>

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
        <div class="hidden lg:grid grid-cols-3 text-white items-center">
          <Contents />
        </div>
      </div>
    </div>
  </header>
}
