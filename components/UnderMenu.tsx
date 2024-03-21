import HeaderMenu from "../islands/HeaderMenu.tsx";

const Contents = () => (
  <>
    <div>ホーム</div>
    <div>About</div>
    <div>SNS(開発中)</div>
  </>
);

export default function Header() {
  return (
    <div id="sp-fixed-menu" class="lg:hidden w-full border-t">
      <ul class="">
        <li>
          <a href="#">
            <img class="w-6 flex" src="./icons/talk.svg" alt="トーク" />
          </a>
        </li>
        <li>
          <a href="#">
            <img class="w-6 m-auto" src="./icons/mail.svg" alt="DM" />
          </a>
        </li>
        <li>
          <a href="#">
            <img class="w-6 m-auto" src="./icons/home.svg" alt="ホーム" />
          </a>
        </li>
        <li>
          <a href="#">
            <img class="w-6 m-auto" src="./icons/serach.svg" alt="検索" />
          </a>
        </li>
        <li>
          <a href="#">
            <img class="w-6 m-auto" src="./icons/bell.svg" alt="通知" />
          </a>
        </li>
      </ul>
    </div>
  );
}
