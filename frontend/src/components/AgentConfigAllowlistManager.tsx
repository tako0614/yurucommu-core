import { useMemo, useState } from "react";
import type React from "react";
import {
  ApiError,
  getAgentConfigAllowlist,
  updateAgentConfigAllowlist,
  type AgentConfigAllowlistResponse,
} from "../lib/api-client";
import { useAsyncResource } from "../lib/useAsyncResource";

const sourceBadge = (source?: string): string => {
  if (!source) return "";
  return source === "stored" ? "stored config" : "runtime config";
};

const combineWarnings = (res: AgentConfigAllowlistResponse | null): string[] => {
  if (!res) return [];
  return [...(res.warnings ?? []), ...(res.reload?.warnings ?? [])].filter(Boolean);
};

export default function AgentConfigAllowlistManager() {
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetcher = async (): Promise<AgentConfigAllowlistResponse | null> => {
    try {
      setForbidden(false);
      setError("");
      return await getAgentConfigAllowlist();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return null;
      }
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      return null;
    }
  };

  const [allowlist, { setData, refetch }] = useAsyncResource(fetcher);

  const entries = useMemo(() => allowlist.data?.allowlist ?? [], [allowlist.data]);
  const warnings = useMemo(() => combineWarnings(allowlist.data ?? null), [allowlist.data]);

  const applyAllowlist = async (next: string[]) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await updateAgentConfigAllowlist(next);
      setData(res);
      const updated = res.updated !== false;
      setMessage(updated ? "エージェントの許可範囲を更新しました。" : "変更はありませんでした。");
      setInput("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        setError("管理者のみ操作できます。");
      } else {
        setError(err instanceof Error ? err.message : "更新に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (!value) {
      setError("許可するパスを入力してください。");
      return;
    }
    const current = new Set(entries);
    if (current.has(value)) {
      setMessage("既に追加済みです。");
      return;
    }
    current.add(value);
    await applyAllowlist(Array.from(current.values()));
  };

  const handleRemove = async (path: string) => {
    if (!confirm(`"${path}" を allowlist から削除しますか？`)) return;
    const next = entries.filter((entry) => entry !== path);
    await applyAllowlist(next);
  };

  const refresh = async () => {
    setMessage("");
    setError("");
    await refetch();
  };

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">AI エージェントの設定変更許可</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            `tool.updateTakosConfig` を利用する AI エージェントが変更できる config パスを明示します。
            allowlist が空の場合、AI は設定を書き換えられません。
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            例: <code className="font-mono">ai.enabled_actions</code>, <code className="font-mono">custom.feature_flag</code>, <code className="font-mono">*</code>{" "}
            （全許可）, <code className="font-mono">ai</code> または <code className="font-mono">ai.*</code>（AI 配下を許可）
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sourceBadge(allowlist.data?.source) && (
            <span className="px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
              {sourceBadge(allowlist.data?.source)}
            </span>
          )}
          <button
            type="button"
            className="px-2 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
            onClick={() => void refresh()}
            disabled={allowlist.loading}
          >
            再読込
          </button>
        </div>
      </div>

      {forbidden && (
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
          このセクションは管理者のみが利用できます。
        </div>
      )}

      {!forbidden && (
        <>
          {warnings.length > 0 && (
            <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-100 space-y-1">
              <div className="font-semibold text-xs tracking-wide uppercase">注意</div>
              {warnings.map((item) => (
                <div key={item} className="leading-snug">
                  {item}
                </div>
              ))}
            </div>
          )}

          <form className="flex flex-col md:flex-row gap-2 mb-3" onSubmit={(e) => void handleAdd(e)}>
            <input
              className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-neutral-900"
              placeholder="ai.enabled_actions, custom.flag など"
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-full bg-gray-900 text-white disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "保存中…" : "追加"}
            </button>
          </form>

          {message && (
            <div className="mb-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
            {allowlist.loading ? (
              <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400">読み込み中...</div>
            ) : entries.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <div>allowlist が空です。AI は takos-config を変更できません。</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">必要なパスだけを明示的に追加してください。</div>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {entries.map((entry) => (
                  <li key={entry} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-sm break-all">
                        {entry}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                      onClick={() => void handleRemove(entry)}
                      disabled={busy}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
