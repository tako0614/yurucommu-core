import { atom } from "solid-jotai";

import setting from "../setting.json";

export const loginState = atom<boolean>();
export const loadState = atom<boolean>(false);
export const userIdState = atom<string | null>();
export const webSocketState = atom<WebSocket | null>();
export const pageState = atom<string>();
export const inputMessageState = atom<string>("");
export const setDefaultServerState = atom<boolean>(setting.setDefaultServer);
export const defaultServerState = atom<string>(setting.domain);
export const exproleServerState = atom<{
  domain: string;
}[]>(setting.servers);
export const IdentityKeyAndAccountKeyState = atom<
  [string, string, {
    identityKey: {
      public: string;
      private: string;
    };
    accountKey: {
      public: string;
      private: string;
    };
  }][]
>([]);
export const deviceKeyState = atom<string | null>();
export const friendMasterKeysState = atom<{
  userId: string;
  masterKey: string;
}[]>();
export const friendIdentityKeyAndAccountKeyState = atom<{
  userId: string;
  identityKey: string;
  accountKey?: string;
}[]>();
export const setUpState = atom<boolean>(false);
export const EncryptedSessionState = atom<boolean>(false);
export const isValidInputState = atom<boolean>(false);

export const domainState = atom<string | null>();
export const sessionidState = atom<string | null>();

export const iconState = atom<string | null>();
export const nicknameState = atom<string | null>();
export const descriptionState = atom<string | null>();
export const birthdayState = atom<string | null>();
export const notificationState = atom<{
  id: string;
  type: string;
  sender: string;
  query?: string;
}[]>([]);

export const talkListState = atom<{
  timestamp: string;
  latestMessage: string;
  type: "group" | "friend";
  roomid: string;
}[]>();

export const messageValueState = atom<[string, {
  verified: boolean;
  encrypted: boolean;
  content: string;
  type: string;
  timestamp: string;
}][]>([]);
export const friendsState = atom<string[]>([]);

export const messageListState = atom<{
  userName: string;
  messageid: string;
  timestamp: string;
}[]>([]);

// メッセージ内容を Map 形式で保存するステート
export const messageContentMapState = atom<
  Map<string, {
    verified: boolean;
    encrypted: boolean;
    content: string;
    type: string;
    timestamp: string;
  }>
>(new Map());

// メッセージのロード状態を管理
export const messageLoadingState = atom<boolean>(false);

export const iconsState = atom<{
  key: string;
  type: "group" | "friend";
  icon: string;
}[]>([]);

export const nickNamesState = atom<{
  key: string;
  type: "group" | "friend";
  nickName: string;
}[]>([]);
