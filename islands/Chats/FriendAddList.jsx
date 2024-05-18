// deno-lint-ignore-file
import User from "./AddFriend.tsx"
import GetAddFriendKey from "./getAddFriendKey.tsx"
import FriendRequest from "./FriendRequest.tsx"
function ChatList(props) {
  return (
    <div class="p-talk-list">
      <h1 class="p-talk-list-title">友達を追加</h1>
      <div class="p-talk-list-rooms">
        <h1 class="text-lg">友達を追加</h1>
        <ul class="p-talk-list-rooms__ul" id="friendList">
          <User
            userName="idで追加"
            latestMessage=""
            icon="people.png"
          />
          <User userName="QRコードで追加" latestMessage="" />
          <GetAddFriendKey origin={props.origin}></GetAddFriendKey>
        </ul>
      </div>
      <div class="p-talk-list-rooms">
        <h1 class="text-lg">リクエスト</h1>
        <ul class="p-talk-list-rooms__ul" id="friendList">
          <FriendRequest></FriendRequest>
        </ul>
      </div>
    </div>
  )
}
export default ChatList
