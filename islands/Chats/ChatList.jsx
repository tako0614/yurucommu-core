// deno-lint-ignore-file
import { useEffect, useState } from "preact/hooks";
import { h, render } from "preact";
import User from "../../components/Chats/ChatUserList.jsx";
import re from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/denonext/preact-render-to-string.mjs";
function ChatList(props) {
  const [showAddFriendForm, setShowAddFriendForm] = useState(
    props.isAddFriendForm,
  );
  useEffect(async () => {
    const csrftokenres = await fetch(
      "./api/csrfToken?origin=http://localhost:8000",
      {
        method: "GET",
      },
    );
    const csrftoken = await csrftokenres.json();
    const result = await fetch("./api/chats/friendList", {
      method: "POST",
      body: JSON.stringify({
        csrftoken: csrftoken.csrftoken,
      }),
    });
    const res = await result.json();
    if (res.status == "You are alone") {
      const ListElement = document.getElementById("friendList");
      render(
        <User userName="友達がいません！！" latestMessage="ざぁこ♡ざぁこ♡" />,
        ListElement,
      );
      return;
    }
    let ListElement;
    result.sort((a, b) => {
      a.latestMessageTime - b.latestMessageTime;
    });
    let elements = [];
    result.map((friend) => {
      const element = (
        <User
          userName={friend.userName}
          latestMessage={friend.latestMessage}
          addFriendKey={props.addFriendKey}
        />
      );
      elements.push(element);
    });
    document.getElementById("friendList").appendChild(user);
    render(elements, ListElement);
  }, []);
  return (
    <>
      {showAddFriendForm && (
        <AddFriendForm isAddFriendForm={props.isAddFriendForm} />
      )}
      <div class="p-talk-list">
        <h1 class="p-talk-list-title">トーク</h1>
        <div class="p-talk-list-search">
          <form name="talk-search">
            <label>
              <input
                type="text"
                placeholder="トークルーム・メッセージを検索"
              />
            </label>
          </form>
        </div>
        <div class="p-talk-list-rooms">
          <ul class="p-talk-list-rooms__ul" id="friendList">
            {/**ここにフレンドリストを表示 useEffectでレンダリング */}
          </ul>
        </div>
      </div>
    </>
  );
}
const AddFriendForm = () => {
  return (
    <>
      <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(91,112,131,0.4)] left-0 top-0">
        <div class="bg-[#010005] lg:w-1/3 w-full h-full lg:h-2/3 mx-auto lg:my-[7%] p-5 lg:rounded-xl">
          <div class="flex justify-end bg-blue-500">
            <span
              class="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer"
              onClick={() => {
                window.location.href = "./";
              }}
            >
              ×
            </span>
          </div>
          <div class="w-4/5 mx-auto my-0">
            テストメッセージ
          </div>
        </div>
      </div>
    </>
  );
};

export default ChatList;
