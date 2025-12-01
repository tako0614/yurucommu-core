import { createSignal, Show } from "solid-js";
import StorageManager from "../components/StorageManager";
import ActivityPubBlocklistManager from "../components/ActivityPubBlocklistManager";
import { registerPushDevice, removePushDevice } from "../lib/api";

export default function Settings() {
  const [pushToken, setPushToken] = createSignal("");
  const [deviceName, setDeviceName] = createSignal("");
  const [platform, setPlatform] = createSignal("web");
  const [pushMessage, setPushMessage] = createSignal<string | null>(null);
  const [pushBusy, setPushBusy] = createSignal(false);

  const handleRegisterPush = async () => {
    if (!pushToken().trim()) {
      setPushMessage("デバイストークンを入力してください。");
      return;
    }
    setPushBusy(true);
    setPushMessage(null);
    try {
      await registerPushDevice({
        token: pushToken().trim(),
        platform: platform(),
        device_name: deviceName().trim() || undefined,
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      });
      setPushMessage("プッシュ通知を登録しました。");
    } catch (error: any) {
      setPushMessage(error?.message || "登録に失敗しました。");
    } finally {
      setPushBusy(false);
    }
  };

  const handleRemovePush = async () => {
    if (!pushToken().trim()) {
      setPushMessage("削除するデバイストークンを入力してください。");
      return;
    }
    setPushBusy(true);
    setPushMessage(null);
    try {
      await removePushDevice(pushToken().trim());
      setPushMessage("プッシュ通知の登録を削除しました。");
    } catch (error: any) {
      setPushMessage(error?.message || "削除に失敗しました。");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-6">
      <h1 class="text-2xl font-bold mb-6">設定</h1>

      <div class="space-y-6">
        <ActivityPubBlocklistManager />

        {/* Storage Management Section */}
        <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <StorageManager />
        </section>

        {/* Future Settings Placeholder */}
        <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h2 class="text-lg font-semibold mb-2">その他の設定</h2>
          <div class="space-y-3">
            <div>
              <div class="text-sm text-gray-600 dark:text-gray-400">
                プッシュ通知デバイスの登録/削除を行います。
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <div class="space-y-2">
                <label class="text-sm text-gray-600 dark:text-gray-400">
                  デバイストークン
                </label>
                <input
                  class="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                  value={pushToken()}
                  onInput={(e) => setPushToken((e.target as HTMLInputElement).value)}
                  placeholder="通知サービスから取得したトークン"
                />
              </div>
              <div class="space-y-2">
                <label class="text-sm text-gray-600 dark:text-gray-400">
                  デバイス名 (任意)
                </label>
                <input
                  class="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                  value={deviceName()}
                  onInput={(e) => setDeviceName((e.target as HTMLInputElement).value)}
                  placeholder="例: iPhone, Chrome"
                />
              </div>
            </div>
            <div class="space-y-2">
              <label class="text-sm text-gray-600 dark:text-gray-400">
                プラットフォーム
              </label>
              <select
                class="w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                value={platform()}
                onChange={(e) => setPlatform((e.target as HTMLSelectElement).value)}
              >
                <option value="web">Web</option>
                <option value="ios">iOS</option>
                <option value="android">Android</option>
              </select>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                class="px-4 py-2 rounded-full bg-gray-900 text-white disabled:opacity-60"
                onClick={() => void handleRegisterPush()}
                disabled={pushBusy()}
              >
                {pushBusy() ? "処理中…" : "登録"}
              </button>
              <button
                class="px-4 py-2 rounded-full border border-gray-300 dark:border-gray-700 disabled:opacity-60"
                onClick={() => void handleRemovePush()}
                disabled={pushBusy()}
              >
                削除
              </button>
              <Show when={pushMessage()}>
                <span class="text-sm text-gray-600 dark:text-gray-400">
                  {pushMessage()}
                </span>
              </Show>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
