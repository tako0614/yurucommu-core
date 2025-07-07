import {
  createEffect,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";

type MenuItem = {
  label: string | JSX.Element | (() => JSX.Element);
  onClick: () => void;
  danger?: boolean;
};

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  header?: JSX.Element; // ヘッダーとして表示する要素を追加
}

export function ContextMenu(props: ContextMenuProps) {
  const [position, setPosition] = createSignal({
    x: props.x,
    y: props.y,
  });
  let menuRef: HTMLDivElement | undefined;

  // ドキュメント上の任意の場所をクリックしたらメニューを閉じる
  createEffect(() => {
    const handleClick = () => props.onClose();
    document.addEventListener("click", handleClick);
    onCleanup(() => document.removeEventListener("click", handleClick));
  });

  // ESCキーでメニューを閉じる
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  // メニューの位置調整（画面外にはみ出さないように）
  const adjustedPosition = () => {
    const maxX = window.innerWidth - 200; // メニューの想定最大幅
    const maxY = window.innerHeight - props.items.length * 40; // メニューの想定最大高さ

    return {
      x: Math.min(props.x, maxX),
      y: Math.min(props.y, maxY),
    };
  };

  // マウント時にメニューサイズに基づいて位置調整
  onMount(() => {
    if (menuRef) {
      const menuWidth = menuRef.offsetWidth;
      const menuHeight = menuRef.offsetHeight;

      // 画面の端に表示される場合は位置を調整
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      let x = props.x;
      let y = props.y;

      // 右側の境界チェック
      if (x + menuWidth > windowWidth) {
        x = windowWidth - menuWidth - 10;
      }

      // 下側の境界チェック
      if (y + menuHeight > windowHeight) {
        y = windowHeight - menuHeight - 10;
      }

      // 左側の境界チェック
      if (x < 10) x = 10;

      // 上側の境界チェック
      if (y < 10) y = 10;

      setPosition({ x, y });
    }

    // グローバルのクリックイベントリスナーを追加
    const handleDocumentClick = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("contextmenu", handleDocumentClick);
    window.addEventListener("resize", props.onClose);
    window.addEventListener("scroll", props.onClose);

    onCleanup(() => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("contextmenu", handleDocumentClick);
      window.removeEventListener("resize", props.onClose);
      window.removeEventListener("scroll", props.onClose);
    });
  });

  return (
    <Portal mount={document.body}>
      <div
        ref={menuRef}
        class="fixed message-context-menu z-[9999]"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
          transform: "translate(0, 0)",
        }}
      >
        <div class="bg-gray-800 text-white rounded-lg shadow-lg p-2 min-w-[150px]">
          {/* ヘッダーセクションを追加 */}
          <Show when={props.header}>
            <div class="border-b border-gray-700 pb-2 mb-2">
              {props.header}
            </div>
          </Show>

          <ul class="whitespace-nowrap">
            <For each={props.items}>
              {(item) => (
                <li
                  class={`cursor-pointer p-2 hover:${
                    item.danger ? "bg-red-700" : "bg-gray-700"
                  } rounded transition-colors duration-200`}
                  onClick={() => {
                    item.onClick();
                    props.onClose();
                  }}
                >
                  {typeof item.label === "function" ? item.label() : item.label}
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Portal>
  );
}
