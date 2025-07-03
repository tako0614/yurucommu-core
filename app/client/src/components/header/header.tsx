import { JSX } from "solid-js/jsx-runtime";
// Import atom state for navigation
import { useAtom } from "solid-jotai";
import { selectedAppState, AppPage } from "../../states/app.ts";

const HeaderButton = (props: { page: AppPage; children: JSX.Element }) => {
  const [selectedApp, setSelectedApp] = useAtom(selectedAppState);

  return (
    <li
      class={`l-header__ul-item ${selectedApp() === props.page ? 'is-active' : ''}`}
      onClick={() => setSelectedApp(props.page)}
    >
      {props.children}
    </li>
  );
}

export default function ChatHeader() {
  return (
    <>
      <header
        class="l-header"
        id="header"
      >
        <ul class="l-header__ul">
          <HeaderButton
            page="home"
          >
            <a>
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="homeAltIconTitle"
                stroke="#ffffff"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="homeAltIconTitle">Home</title>{" "}
                <path d="M3 10.182V22h18V10.182L12 2z" />{" "}
                <rect width="6" height="8" x="9" y="14" />
              </svg>
            </a>
          </HeaderButton>
          <HeaderButton
            page="microblog"
          >
            <a>
              <svg
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              width="100%"
              height="100%"
              viewBox="0 0 24 24"
              aria-labelledby="microblogIconTitle"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
              >
              <title id="microblogIconTitle">Microblog</title>
              <path d="M4 21h16" />
              <path d="M15.232 5.232l3.536 3.536L9 18.536H5.464V15L15.232 5.232z" />
              </svg>
            </a>
          </HeaderButton>
        </ul>
      </header>
    </>
  );
}
