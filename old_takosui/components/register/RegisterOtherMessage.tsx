import { convertTime } from "../../utils/message/messageUtils.tsx";

import {
  getSecurityStatus,
  renderMessageContent,
} from "../talk/message/MessageContent.tsx";
// インターフェースを使用するようにコンポーネント定義を修正
const ChatOtherMessage = ({
  icon,
  nickName,
  time,
  content,
}: {
  icon: string;
  nickName: string;
  time: string | number | Date;
  content: any;
}) => {
  const isPrimaryClass = true
    ? "c-talk-chat other primary"
    : "c-talk-chat other subsequent";

  return (
    <li class={isPrimaryClass} style={{}}>
      <div class="c-talk-chat-box mb-1">
        {true && (
          <div class="c-talk-chat-icon">
            <img
              src={icon}
              alt="image"
              class="rounded-full text-white dark:text-black"
            />
          </div>
        )}
        <div class="c-talk-chat-right">
          {true && (
            <div class="c-talk-chat-name">
              <p>{nickName}</p>
            </div>
          )}
          <div class="flex flex-col space-y-1">
            <div class="flex items-end">
              {renderMessageContent(content, nickName)}
              <span class="text-xs text-gray-500 ml-2">
                {convertTime(time)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

export default ChatOtherMessage;
