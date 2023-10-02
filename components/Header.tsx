import HeaderMenu from '../islands/HeaderMenu.tsx'

const Contents = () => <>
  <div>ホーム</div>
  <div>About</div>
  <div>SNS(開発中)</div>
</>

export default function Header () {
  return <header>
    <div className="w-full">
      <div className="pr-3">
        <div class="block lg:hidden">
          <HeaderMenu>
            <Contents />
          </HeaderMenu>
        </div>
        <div>
          <a className="logo-area"><img src="/logo.png" alt="takoserver logo" className="logo-img" /></a>
        </div>
        <div class="hidden lg:grid grid-cols-3 text-white">
          <Contents />
        </div>
      </div>
    </div>
  </header>
}
