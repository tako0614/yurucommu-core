import { createEffect, createSignal, For, Show } from "solid-js";
import { DEFAULT_ICON } from "../../utils/defaultIcon.ts";
import { TakosFetchMultipleEntityInfo } from "../../../utils/chache/Icon.ts";
import { atom, useAtom, useSetAtom } from "solid-jotai";

export interface MentionDisplayProps {
  mentions: string[];
  align?: "start" | "end"; // 左寄せか右寄せか
}

const showMentionListState = atom(false);

const showMentionListContentState = atom<
  { id: string; icon: string | null; nickName: string }[]
>([]);

const MentionDisplay = (props: MentionDisplayProps) => {
  const [mentionInfos, setMentionInfos] = createSignal<
    { id: string; icon: string | null; nickName: string }[]
  >([]);
  const [showMentionList, setShowMentionList] = useAtom(showMentionListState);
  const [showMentionListContent, setShowMentionListContent] = useAtom(
    showMentionListContentState,
  );
  // メンションリストの表示切り替え
  const toggleMentionList = () => {
    setShowMentionList(!showMentionList());
    setShowMentionListContent(mentionInfos());
  };

  // メンションされたユーザーの情報を取得
  createEffect(async () => {
    if (props.mentions && props.mentions.length > 0) {
      try {
        const mentionMap = await TakosFetchMultipleEntityInfo(props.mentions);
        console.log(mentionMap, props.mentions);
        // 配列に変換してset
        const array: { id: string; icon: string | null; nickName: string }[] =
          [];
        mentionMap.forEach((value, key) => {
          array.push({ id: key, icon: value.icon, nickName: value.nickName });
        });
        setMentionInfos(array);
      } catch (error) {
        console.error("メンション情報の取得に失敗しました", error);
      }
    }
  });

  return (
    <>
      <div
        class={`flex ${
          props.align === "end" ? "justify-end" : "justify-start"
        } mb-1`}
      >
        <div
          class="flex items-center gap-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded"
          onClick={toggleMentionList}
        >
          <For
            each={mentionInfos().filter((item) => {
              if (item.id === "everyone") {
                return props.mentions.includes("everyone");
              }
              return props.mentions.slice(0, 3).includes(item.id);
            })}
          >
            {(info) => (
              <div class="relative">
                <img
                  src={info.icon || DEFAULT_ICON}
                  alt={info.id.split("@")[0]}
                  class="w-6 h-6 rounded-full border-2 border-white dark:border-gray-800"
                  title={info.nickName || info.id.split("@")[0]}
                />
              </div>
            )}
          </For>
          <Show when={props.mentions.length > 3}>
            <div class="bg-gray-200 dark:bg-gray-700 w-6 h-6 rounded-full flex items-center justify-center text-xs">
              +{props.mentions.length - 3}
            </div>
          </Show>
        </div>
      </div>
    </>
  );
};

export function MentionListModal() {
  const [showMentionList, setShowMentionList] = useAtom(showMentionListState);
  const [mentionInfos] = useAtom(showMentionListContentState);
  const onClose = () => {
    setShowMentionList(false);
  };
  return (
    <Show when={showMentionList()}>
      <div
        class="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center"
        onClick={() => onClose()}
      >
        <div
          class="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-md w-full max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 class="text-lg font-medium mb-3 border-b pb-2">メンション一覧</h3>
          <div class="space-y-2">
            <For each={mentionInfos()}>
              {(info) => (
                <div class="flex items-center gap-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <img
                    src={info.icon || DEFAULT_ICON}
                    alt={info.id.split("@")[0]}
                    class="w-8 h-8 rounded-full"
                  />
                  <div>
                    <p class="font-medium">
                      {info.nickName || info.id.split("@")[0]}
                    </p>
                    <p class="text-sm text-gray-500">{info.id}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default MentionDisplay;
