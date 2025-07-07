import { pageState } from "../../utils/state";
import { useAtom } from "solid-jotai";
import { shoowGroupPopUp, showGroupfindPopUp } from "../utils/CreateGroup";
export default function talkListHeader() {
  const [page] = useAtom(pageState);
  return (
    <>
      {page() == "talk" && (
        <>
          <One />
        </>
      )}
      {page() == "friend" && (
        <>
          {console.log(page())}
          <Two />
        </>
      )}
      {page() == "notification" && (
        <>
          <Notification />
        </>
      )}
    </>
  );
}
function OneTitle() {
  const [_showGroupPopUp, setShowGroupPopUp] = useAtom(shoowGroupPopUp);
  const [_showGroupfindPopUp, setShowGroupfindPopUp] = useAtom(
    showGroupfindPopUp,
  );
  return (
    <div class="flex justify-between items-center w-full">
      <h1 class="p-talk-list-title">トーク</h1>
      <div class="flex space-x-2">
        <button
          onClick={() => {
            console.log("showGroupfindPopUp");
            setShowGroupfindPopUp(true);
          }}
          class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors focus:outline-none"
          aria-label="グループを検索"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button
          onClick={() => {
            setShowGroupPopUp(true);
          }}
          class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors focus:outline-none"
          aria-label="新規グループ作成"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
    </div>
  );
}
function OneValue() {
  return (
    <>
      <div class="p-talk-list-search">
        <form name="talk-search">
          <label>
            <input
              type="text"
              placeholder="検索"
            />
          </label>
        </form>
      </div>
    </>
  );
}
function TwoTitle() {
  return (
    <>
      <h1 class="p-talk-list-title">トークを追加</h1>
    </>
  );
}
function TwoValue() {
  return (
    <>
    </>
  );
}

function Notification() {
  return <h1 class="p-talk-list-title">通知</h1>;
}

function One() {
  return (
    <>
      <OneTitle />
      <OneValue />
    </>
  );
}
function Two() {
  return (
    <>
      <TwoTitle />
      <TwoValue />
    </>
  );
}
