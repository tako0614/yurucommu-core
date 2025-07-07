import { atom, useAtom, useSetAtom } from "solid-jotai";
import { createRoot } from "solid-js";

// メンションリスト用の状態
const mentionListState = atom<string[]>([]);

// リプライターゲット用の状態
const replyTargetState = atom<
  {
    id: string;
    content?: string;
    type: "text" | "image" | "video" | "audio" | "file";
  } | null
>(null);

// everyoneメンション用の特別な識別子
export const EVERYONE_MENTION_ID = "everyone";

function toggleMention(userId: string) {
  createRoot(() => {
    const [mentionList, setMentionList] = useAtom(mentionListState);
    const currentMentions = mentionList();
    if (currentMentions.includes(userId)) {
      // 既に含まれている場合は削除
      setMentionList(currentMentions.filter((id) => id !== userId));
    } else {
      // まだ含まれていない場合は追加
      setMentionList([...currentMentions, userId]);
    }
  });
}

// everyoneをメンションする関数
function mentionEveryone() {
  createRoot(() => {
    const [mentionList, setMentionList] = useAtom(mentionListState);
    const currentMentions = mentionList();

    // すでにeveryoneメンションがある場合は削除、なければ追加
    if (currentMentions.includes(EVERYONE_MENTION_ID)) {
      setMentionList(
        currentMentions.filter((id) => id !== EVERYONE_MENTION_ID),
      );
    } else {
      // everyoneを追加する場合、他の個別メンションは削除（everyoneが優先）
      setMentionList([EVERYONE_MENTION_ID]);
    }
  });
}

// 特定のユーザーのメンションを削除する関数
const removeMention = (userId: string) => {
  createRoot(() => {
    const [mentionList, setMentionList] = useAtom(mentionListState);
    const currentMentions = mentionList();
    setMentionList(currentMentions.filter((id) => id !== userId));
  });
};

const setReplyToMessage = (
  messageId: string,
  type: "text" | "image" | "video" | "audio" | "file",
  content?: string,
) => {
  createRoot(() => {
    const setReplyTarget = useSetAtom(replyTargetState);
    setReplyTarget({ id: messageId, type, content });
  });
};

// メンションとリプライ情報をクリア
const clearMentionReplyState = () => {
  createRoot(() => {
    const setMentionList = useSetAtom(mentionListState);
    const setReplyTarget = useSetAtom(replyTargetState);
    setMentionList([]);
    setReplyTarget(null);
  });
};

export {
  clearMentionReplyState,
  mentionEveryone,
  mentionListState,
  removeMention,
  replyTargetState,
  setReplyToMessage,
  toggleMention,
};
