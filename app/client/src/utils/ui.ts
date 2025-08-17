import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";

// ローディングの“見せ方”を改善するためのユーティリティ
// - delay: この時間以内に読み込みが終わればスケルトンを出さない
// - min: 一度出したら最低この時間は表示してチラつきを避ける
export function createDelayedVisibility(
  visible: Accessor<boolean>,
  delay = 250,
  min = 300,
): Accessor<boolean> {
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
      // すぐには出さず、一定時間経ってから表示（データが速く返るケースでの点滅防止）
      if (!shown()) {
        clearTimers();
        delayTimer = setTimeout(() => {
          setShown(true);
          shownAt = Date.now();
        }, delay) as unknown as number;
      }
    } else {
      // 既に表示している場合は最短表示時間を満たしてから消す
      if (shown()) {
        const elapsed = Date.now() - shownAt;
        const rest = Math.max(0, min - elapsed);
        clearTimers();
        minTimer = setTimeout(() => setShown(false), rest) as unknown as number;
      } else {
        // まだ表示していない場合は遅延タイマーだけ止める
        clearTimers();
        setShown(false);
      }
    }
  });

  onCleanup(() => clearTimers());

  return shown;
}

