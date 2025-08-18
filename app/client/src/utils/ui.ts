import {
  Accessor,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from "solid-js";

// ローディングの“見せ方”を改善するためのユーティリティ
// - delay: この時間以内に読み込みが終わればスケルトンを出さない
// - min: 一度出したら最低この時間は表示してチラつきを避ける
export function createDelayedVisibility(
  visible: Accessor<boolean>,
  delay = 250,
  min = 300,
): Accessor<boolean> {
  // 現在のオーナー（コンポーネントのルート）を取得
  const owner = getOwner();

  const factory = () => {
    const [shown, setShown] = createSignal(false);
    let delayTimer: number | undefined;
    let minTimer: number | undefined;
    let shownAt = 0;

    const clearTimers = () => {
      if (delayTimer) clearTimeout(delayTimer);
      if (minTimer) clearTimeout(minTimer);
      delayTimer = undefined;
      minTimer = undefined;
    };

    createEffect(() => {
      const v = visible();
      if (v) {
        if (!shown()) {
          clearTimers();
          delayTimer = setTimeout(() => {
            setShown(true);
            shownAt = Date.now();
          }, delay) as unknown as number;
        }
      } else {
        if (shown()) {
          const elapsed = Date.now() - shownAt;
          const rest = Math.max(0, min - elapsed);
          clearTimers();
          minTimer = setTimeout(
            () => setShown(false),
            rest,
          ) as unknown as number;
        } else {
          clearTimers();
          setShown(false);
        }
      }
    });

    onCleanup(() => clearTimers());
    return shown;
  };

  // オーナーがない（= コンポーネント外）で呼ばれた場合でも警告を出さず動作させる
  if (!owner) {
    let dispose: (() => void) | undefined;
    const accessor = createRoot((d) => {
      dispose = d;
      return factory();
    });
    // 最低限のリーク防止として、ページ離脱時に破棄
    const off = () => {
      if (dispose) dispose();
      globalThis.removeEventListener("beforeunload", off);
    };
    globalThis.addEventListener("beforeunload", off);
    return accessor;
  }

  // 通常は現在のオーナー配下で作成
  return runWithOwner(owner, factory);
}
