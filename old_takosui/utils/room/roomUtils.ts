import { TakosFetch } from "../TakosFetch";

// メッセージの型定義
export interface Message {
  userName: string;
  messageid: string;
  timestamp: string;
}

// ルームの型定義 - roomNameをlatestMessageから変更
export interface Room {
  roomid: string;
  roomName: string; // latestMessageからroomNameに変更
  type: "friend" | "group";
}

// グループチャンネル情報の型定義
export interface GroupChannel {
  members: {
    userId: any;
    role: string[];
  }[];
  channels: {
    category: string;
    id: string;
    name: string;
    permissions: { roleId: string; permissions: string[] }[];
    order: number;
  }[];
  roles: { color: string; id: string; name: string; permissions: string[] }[];
  categories: {
    id: string;
    name: string;
    permissions: { roleId: string; permissions: string[] }[];
    order: number;
  }[];
  owner: string;
}

// ルーム選択関数のパラメータ型定義
interface RoomSelectorParams {
  setRoomNickName: (value: string) => void;
  setSelectedRoom: (room: Room) => void;
  setIsSelectRoom: (value: boolean) => void;
  setMessageList: (messages: Message[]) => void;
  setLoadedMessageList: (value: boolean) => void;
  setSelectedChannel: (channelId: string) => void;
  setGroupChannel: (groupChannel: GroupChannel) => void;
}

export function createRoomSelector({
  setRoomNickName,
  setSelectedRoom,
  setIsSelectRoom,
  setMessageList,
  setLoadedMessageList,
  setSelectedChannel,
  setGroupChannel,
}: RoomSelectorParams) {
  return async function selectRoom({
    roomid,
    latestMessage,
    type,
    nickName,
  }: {
    roomid: string;
    latestMessage: string;
    type: "friend" | "group";
    nickName: string;
  }) {
    // 選択されたルームの情報を先にセット
    setIsSelectRoom(true);
    setSelectedRoom({ roomid, roomName: latestMessage, type });
    setRoomNickName(nickName);

    // 強制的にロード状態をリセット
    setLoadedMessageList(false);
    setMessageList([]);

    if (type === "friend") {
      const messages = await TakosFetch("/api/v2/message/friend/" + roomid);
      const messagesJson = (((await messages.json()).messages) as Message[])
        .sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      setMessageList(messagesJson);

      const currentPath = window.location.pathname;
      const pageSegment = currentPath.split("/").filter(Boolean)[0] || "talk";
      window.history.pushState(
        {},
        "",
        `/${pageSegment}/${encodeURIComponent(roomid)}`,
      );
    } else if (type === "group") {
      const match = roomid.match(/^g\{([^}]+)\}@(.+)$/);
      if (!match) {
        return;
      }
      const groupName = match[1];
      const domainFromRoom = match[2];
      const groupId = groupName + "@" + domainFromRoom;

      const baseUrl = `https://${domainFromRoom}/_takos/v1/group`;
      const channelsPromise = TakosFetch(
        `${baseUrl}/channels/${groupId}`,
      ).then((res) => res.json());
      const rolePromise = TakosFetch(
        `${baseUrl}/role/${groupId}`,
      ).then((res) => res.json());
      const membersPromise = TakosFetch(
        `${baseUrl}/members/${groupId}`,
      ).then((res) => res.json());
      const ownerPromise = TakosFetch(
        `${baseUrl}/owner/${groupId}`,
      ).then((res) => res.json());
      const defaultChannelPromise = TakosFetch(
        `${baseUrl}/defaultChannel/${groupId}`,
      ).then((res) => res.json());

      const [
        channelsResult,
        roleResult,
        membersResult,
        ownerResult,
        defaultChannelResult,
      ] = await Promise.all([
        channelsPromise,
        rolePromise,
        membersPromise,
        ownerPromise,
        defaultChannelPromise,
      ]);

      const { channels, categories } = channelsResult.channels;
      const role = roleResult.roles;
      const members = membersResult.members;
      const owner = ownerResult.owner;
      const defaultChannelId = defaultChannelResult.defaultChannel;

      setGroupChannel({
        members,
        channels,
        roles: role,
        categories,
        owner,
      });

      const messages = await TakosFetch(
        "/api/v2/message/group/" + roomid + "/" + defaultChannelId,
      );
      const messagesJson = (((await messages.json()).messages) as Message[])
        .sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

      setMessageList(messagesJson);
      setSelectedChannel(defaultChannelId);

      const currentPath = window.location.pathname;
      const pageSegment = currentPath.split("/").filter(Boolean)[0] || "talk";
      window.history.pushState(
        {},
        "",
        `/${pageSegment}/${encodeURIComponent(roomid)}`,
      );
    }
  };
}
