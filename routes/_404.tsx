import { Head } from "$fresh/runtime.ts";

export default function Error404() {
  return (
    <>
    <html>
      <head>
        <title>404 Not Found</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <header>
        <div className="header-menu w-full">
        <div className="header-logo-menu pr-3">
        <div id="nav-drawer">
            <input id="nav-input" type="checkbox" className="nav-unshown" />
            <label id="nav-open" for="nav-input"><span></span></label>
            <label className="nav-unshown" id="nav-close" for="nav-input"></label>
            
        </div>
        <a className="logo-area"><img src="/logo.png" alt="takoserver logo" className="logo-img" /></a>
        </div>
        {/*↓デスクトップ用*/}
          <ul className="dt-ul-menu">
            <li className="dt-nav-menu">ロリコン</li>
            <li className="dt-nav-menu">ショタコン</li>
            <li className="dt-nav-menu">ホモ</li>
          </ul>
        </div>
      </header>
      <section className="pt-10 pb-10">
        <h1 className="text-5xl text-center text-white">404 Not Found</h1>
        <p className="text-xl text-center text-white">このページはないんやで</p>
      </section>
      <footer>
        <p className="text-white text-center">Copyright © 2021-2023 Takoserver All Rights Reserved.</p>
        <p className="text-white text-center"><a href="https://aranpect.com">Aranpect</a></p>
      </footer>
    </html>
    </>
  );
}
