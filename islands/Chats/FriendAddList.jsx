// deno-lint-ignore-file
import { useEffect } from "preact/hooks";
import { h, render } from "preact";
import User from "./AddFriend.jsx";
import re from "https://esm.sh/v135/preact-render-to-string@6.3.1/X-ZS8q/denonext/preact-render-to-string.mjs";
import GetAddFriendKey from "./getAddFriendKey.tsx";
function ChatList(props) {
  return (
    <div class="p-talk-list">
      <h1 class="p-talk-list-title">友達を追加</h1>
      <div class="p-talk-list-rooms">
        <ul class="p-talk-list-rooms__ul" id="friendList">
          <User userName="idで追加" latestMessage="" />
          <User userName="QRコードで追加" latestMessage="" />
          <GetAddFriendKey origin={props.origin}></GetAddFriendKey>
        </ul>
      </div>
    </div>
  );
}
export default ChatList;
const AddFriendId = () => {
};
