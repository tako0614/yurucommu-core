// deno-lint-ignore-file
import { useEffect } from "preact/hooks";
import { h, render } from "preact";
import User from "../../components/Chats/ChatUserList.jsx";
import re from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/denonext/preact-render-to-string.mjs";

function ChatList({ isChoiceUser }) {
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
        <User userName={friend.userName} latestMessage={friend.latestMessage} />
      );
      elements.push(element);
    });
    document.getElementById("friendList").appendChild(user);
    render(elements, ListElement);
  }, []);
  return (
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
  );
}
export default ChatList;
