import { createSignal, Match, Show, Switch } from "solid-js";

interface ChatSendFormProps {
  newMessage: string;
  setNewMessage: (v: string) => void;
  mediaFile: File | null;
  setMediaFile: (f: File | null) => void;
  mediaPreview: string | null;
  setMediaPreview: (url: string | null) => void;
  useEncryption: boolean;
  encryptionKey: string | null;
  toggleEncryption: () => void;
  sendMessage: () => void;
  onShowEncryptionKeyForm?: () => void;
}

export function ChatSendForm(props: ChatSendFormProps) {
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputImage: HTMLInputElement | undefined;
  let fileInputFile: HTMLInputElement | undefined;
  const adjustHeight = (el?: HTMLTextAreaElement) => {
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  const [showMenu, setShowMenu] = createSignal(false);

  return (
    <div class="relative bg-[#1e1e1e]">
      <form
        class="flex items-end gap-[6px] bg-[#252526] h-full py-1"
        onSubmit={(e) => e.preventDefault()}
      >
        <div class="relative">
          <div
            class="p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors"
            onClick={() => setShowMenu(!showMenu())}
            title="メニューを開く"
            style="min-height:28px;"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="display:block"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </div>
          <Show when={showMenu()}>
            <div class="absolute bottom-full mb-1 left-0 bg-[#2e2e2e] p-2 rounded shadow flex flex-col gap-1">
              <button
                type="button"
                class="flex items-center gap-1 hover:bg-[#3a3a3a] px-2 py-1 rounded"
                onClick={() => {
                  setShowMenu(false);
                  fileInputFile?.click();
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  style="display:block"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span class="text-sm">ファイル</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-1 hover:bg-[#3a3a3a] px-2 py-1 rounded"
                onClick={() => {
                  setShowMenu(false);
                  props.toggleEncryption();
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span class="text-sm">
                  {props.useEncryption ? "暗号化中" : "暗号化"}
                </span>
              </button>
            </div>
          </Show>
        </div>
        <div
          class="p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors"
          onClick={() => fileInputImage?.click()}
          title="画像・動画を送信"
          style="min-height:28px;"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="display:block"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <input
            ref={(el) => (fileInputImage = el)}
            type="file"
            accept="image/*,video/*"
            class="hidden"
            style="display:none;"
            onChange={(e) => {
              const f = (e.currentTarget as HTMLInputElement).files?.[0];
              if (!f) return;
              props.setMediaFile(f);
              const reader = new FileReader();
              reader.onload = () => {
                props.setMediaPreview(reader.result as string);
              };
              reader.readAsDataURL(f);
            }}
          />
        </div>
        <div class="flex flex-col flex-1 pr-1">
          <Show when={props.mediaPreview}>
            <div class="mb-2">
              <Switch
                fallback={
                  <a
                    href={props.mediaPreview!}
                    download={props.mediaFile?.name || ""}
                    class="text-blue-400 underline"
                  >
                    {props.mediaFile?.name || "ファイル"}
                  </a>
                }
              >
                <Match when={props.mediaFile?.type.startsWith("image/")}>
                  <img
                    src={props.mediaPreview!}
                    alt="preview"
                    style={{ "max-width": "80px", "max-height": "80px" }}
                  />
                </Match>
                <Match when={props.mediaFile?.type.startsWith("video/")}>
                  <video
                    src={props.mediaPreview!}
                    controls
                    style={{ "max-width": "80px", "max-height": "80px" }}
                  />
                </Match>
                <Match when={props.mediaFile?.type.startsWith("audio/")}>
                  <audio src={props.mediaPreview!} controls />
                </Match>
              </Switch>
            </div>
          </Show>
          <div class="relative flex items-center gap-1 flex-1 border border-[#333333] bg-[#3c3c3c] rounded-[16px] shadow-[1px_1px_10px_rgba(0,0,0,0.2)] pr-2">
            <div
              class="w-full h-full text-[15px] py-[10px] pl-4 m-0 overflow-hidden whitespace-pre-wrap break-words invisible bg-transparent text-white"
              aria-hidden="true"
              style="min-width:0;"
            >
              {props.newMessage.split("\n").map((row) => (
                <>
                  {row}
                  <br />
                </>
              ))}
            </div>
            <label class="flex-1 absolute inset-0 pr-12">
              <textarea
                id="msg"
                class="w-full h-full text-[15px] py-[10px] pl-4 m-0 resize-none bg-transparent whitespace-pre-wrap break-words text-white"
                rows="1"
                ref={(el) => (textareaRef = el)}
                value={props.newMessage}
                placeholder="メッセージを入力"
                style="min-height:32px;max-height:80px;"
                onInput={(e) => {
                  props.setNewMessage(e.currentTarget.value);
                  adjustHeight(textareaRef);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    props.sendMessage();
                  }
                }}
              />
            </label>
          </div>
        </div>
        <div
          class={props.useEncryption && !props.encryptionKey
            ? "h-11 w-11 p-[6px] flex-shrink-0 rounded-full bg-transparent opacity-50 cursor-not-allowed text-white"
            : props.newMessage.trim() || props.mediaFile
            ? "h-11 w-11 p-[6px] flex-shrink-0 rounded-full bg-[#e63535] cursor-pointer hover:bg-[#c52d2d] text-white"
            : "h-11 w-11 p-[6px] flex-shrink-0 rounded-full bg-transparent cursor-default text-white"}
          style="min-height:28px;opacity:1;color:#ffffff;position:relative;z-index:10;display:flex;align-items:center;justify-content:center;"
          title={props.useEncryption && !props.encryptionKey
            ? "暗号化キー未入力のため送信できません"
            : ""}
          onClick={() => {
            if (props.useEncryption && !props.encryptionKey) return;
            if (props.newMessage.trim() || props.mediaFile) {
              props.sendMessage();
            } else {
              alert("録音機能は未実装です");
            }
          }}
        >
          <Show
            when={props.newMessage.trim() || props.mediaFile}
            fallback={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-7 w-7"
                viewBox="0 0 512 512"
                style="color:#ffffff;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6));display:block"
                fill="currentColor"
              >
                <g>
                  <path d="M397.749,224.857v26.108c-0.01,39.105-15.863,74.438-41.566,100.174
		c-25.73,25.702-61.068,41.561-100.18,41.572c-39.111-0.011-74.449-15.87-100.18-41.572
		c-25.708-25.736-41.567-61.069-41.572-100.174v-26.108h-34.6v26.108c0.028,89.441,66.897,163.282,153.286,174.657V512h46.134
		v-86.378c86.388-11.375,153.246-85.216,153.28-174.657v-26.108H397.749z" />
                  <path d="M256.003,340.811c49.592-0.033,89.818-40.254,89.851-89.846V89.857C345.821,40.266,305.6,0.034,256.003,0
		c-49.597,0.034-89.818,40.266-89.852,89.857v161.108C166.185,300.557,206.411,340.778,256.003,340.811z M200.752,89.857
		c0.006-15.261,6.166-28.98,16.208-39.049c10.069-10.047,23.782-16.196,39.044-16.22c15.262,0.023,28.974,6.173,39.044,16.22
		c10.041,10.069,16.202,23.788,16.208,39.049v161.108c-0.006,15.261-6.166,28.98-16.208,39.037
		c-10.064,10.036-23.782,16.196-39.044,16.208c-15.262-0.012-28.98-6.172-39.044-16.208c-10.041-10.057-16.202-23.776-16.208-39.037
		V89.857z" />
                </g>
              </svg>
            }
          >
            <svg
              class="h-7 w-7"
              viewBox="0 0 28 28"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              style="color:#ffffff;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6));display:block"
            >
              <g stroke="none" stroke-width="1" fill="none" style="fill:none">
                <g>
                  <path fill="#ffffff" d="M3.78963301,2.77233335 L24.8609339,12.8499121 C25.4837277,13.1477699 25.7471402,13.8941055 25.4492823,14.5168992 C25.326107,14.7744476 25.1184823,14.9820723 24.8609339,15.1052476 L3.78963301,25.1828263 C3.16683929,25.4806842 2.42050372,25.2172716 2.12264586,24.5944779 C1.99321184,24.3238431 1.96542524,24.015685 2.04435886,23.7262618 L4.15190935,15.9983421 C4.204709,15.8047375 4.36814355,15.6614577 4.56699265,15.634447 L14.7775879,14.2474874 C14.8655834,14.2349166 14.938494,14.177091 14.9721837,14.0981464 L14.9897199,14.0353553 C15.0064567,13.9181981 14.9390703,13.8084248 14.8334007,13.7671556 L14.7775879,13.7525126 L4.57894108,12.3655968 C4.38011873,12.3385589 4.21671819,12.1952832 4.16392965,12.0016992 L2.04435886,4.22889788 C1.8627142,3.56286745 2.25538645,2.87569101 2.92141688,2.69404635 C3.21084015,2.61511273 3.51899823,2.64289932 3.78963301,2.77233335 Z" />
                </g>
              </g>
            </svg>
          </Show>
        </div>
        <Show when={props.useEncryption && !props.encryptionKey}>
          <button
            type="button"
            onClick={() => props.onShowEncryptionKeyForm?.()}
            class="h-11 w-11 p-[6px] flex-shrink-0 rounded-full bg-[#ff3b3b] cursor-pointer hover:bg-[#db3232]"
            title="暗号化キーを設定する"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="display:block"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
        </Show>
        <input
          ref={(el) => (fileInputFile = el)}
          type="file"
          accept="*/*"
          class="hidden"
          style="display:none;"
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (!f) return;
            props.setMediaFile(f);
            const reader = new FileReader();
            reader.onload = () => {
              props.setMediaPreview(reader.result as string);
            };
            reader.readAsDataURL(f);
          }}
        />
      </form>
    </div>
  );
}
