import { Head } from "$fresh/runtime.ts";

export default function Error404() {
  return (
    <>
      <head>
        <title>404 Not Found</title>
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <header>
        <div class="header-menu w-full">
        <div class="header-logo-menu pr-3">
        <div id="nav-drawer">
            <input id="nav-input" type="checkbox" class="nav-unshown hidden" />
            <label id="nav-open" for="nav-input"><span></span></label>
            <label class="nav-unshown" id="nav-close" for="nav-input"></label>
            <div id="nav-content">
              <ul>
                <li>ホーム</li>
                <li>About</li>
                <li>SNS(開発中)</li>
              </ul>
            </div>
        </div>
        <a class="logo-area"><img src="/logo.png" alt="takoserver logo" class="logo-img" /></a>
        </div>
        {/*↓デスクトップ用*/}
          <ul class="dt-ul-menu">
            <li class="dt-nav-menu">ホーム</li>
            <li class="dt-nav-menu">About</li>
            <li class="dt-nav-menu">SNS(開発中)</li>
          </ul>
        </div>
      </header>
      <section class="pt-10 pb-10">
        <h1 class="text-5xl text-center text-white">404 Not Found</h1>
        <p class="text-xl text-center text-white">このページはないんやで</p>
      </section>
      <footer>
        <p class="text-white text-center">Copyright © 2021-2023 Takoserver All Rights Reserved.</p>
        <p class="text-white text-center"><a href="https://aranpect.com">Aranpect</a></p>
      </footer>
    </>
  );
}
