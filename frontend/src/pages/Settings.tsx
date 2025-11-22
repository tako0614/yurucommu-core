import StorageManager from "../components/StorageManager";

export default function Settings() {
  return (
    <div class="max-w-4xl mx-auto px-4 py-6">
      <h1 class="text-2xl font-bold mb-6">設定</h1>

      <div class="space-y-6">
        {/* Storage Management Section */}
        <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <StorageManager />
        </section>

        {/* Future Settings Placeholder */}
        <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h2 class="text-lg font-semibold mb-2">その他の設定</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            その他の設定は今後追加予定です。
          </p>
        </section>
      </div>
    </div>
  );
}
