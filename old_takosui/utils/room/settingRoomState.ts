import { atom } from "solid-jotai";

// 選択中のタブ/セクション
export const selectedTabState = atom<false | string>(false);
// フレンド設定用の選択中タブ
export const selectedFriendTabState = atom<false | string>(false);

// ユーザーリスト
export const friendListState = atom<string[]>([]);

// 編集中のメンバー
export const editMemberState = atom<string | null | false>(null);

// ロール関連のステート
export const showCreateRoleState = atom(false);
export const showEditRoleState = atom<string | null | false>(false);
export const showDeleteRoleConfirmState = atom(false);

// ロール作成/編集用のステート
export const roleNameState = atom("");
export const roleColorState = atom("#000000");
export const rolePermissionsState = atom<string[]>([]);
export const roleIdState = atom("");

// メンバーロール管理
export const showAddRoleState = atom(false);
export const selectedNewRoleState = atom<string>("");
export const pendingMemberRolesState = atom<string[]>([]);

// モデレーションステート
export const showKickConfirmState = atom(false);
export const showBanConfirmState = atom(false);
export const showTimeoutModalState = atom(false);
export const timeoutDurationState = atom(0);

// リクエスト関連
export const joinRequestsState = atom<string[]>([]);
export const isLoadingRequestsState = atom(true);
export const bannedUsersState = atom<string[]>([]);
export const isLoadingBanListState = atom(true);

// グループ設定関連
export const groupNameState = atom("");
export const groupDescriptionState = atom("");
export const groupIconState = atom("");
export const groupIsPrivateState = atom(false);
export const updatedGroupNameState = atom("");
export const updatedGroupDescriptionState = atom("");
export const updatedGroupIconState = atom("");
export const updatedGroupIsPrivateState = atom(false);
