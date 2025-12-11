import { useMemo, useRef, useState } from "react";
import type React from "react";
import { deleteStorage, getStorage, uploadStorage } from "../lib/api-client";
import type { StorageFile } from "../lib/api-client";
import { useAsyncResource } from "../lib/useAsyncResource";

export default function StorageManager() {
  const [files, { refetch }] = useAsyncResource<StorageFile[]>(getStorage);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");
    try {
      await uploadStorage(file);
      await refetch();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm("このファイルを削除しますか？")) return;

    setDeleteError("");
    try {
      await deleteStorage(key);
      await refetch();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "削除に失敗しました");
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getFileName = (key: string): string => {
    const parts = key.split("/");
    return parts[parts.length - 1] || key;
  };

  const totalSize = useMemo(() => {
    const fileList = files.data ?? [];
    return fileList.reduce((sum, file) => sum + file.size, 0);
  }, [files.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">ストレージ管理</h2>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          合計: {formatSize(totalSize)}
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <label className="block mb-2 text-sm font-medium">ファイルをアップロード</label>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="flex-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-200"
            onChange={handleUpload}
            disabled={uploading}
          />
        </div>
        {uploading && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">アップロード中...</p>}
        {uploadError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
      </div>

      {deleteError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        {files.loading ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">読み込み中...</div>
        ) : (files.data?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-gray-600 dark:text-gray-400">ファイルがありません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    ファイル名
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    サイズ
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    アップロード日時
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(files.data ?? []).map((file) => (
                  <tr key={file.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {file.contentType?.startsWith("image/") ? (
                          <img
                            src={`/media/${file.key}`}
                            alt={getFileName(file.key)}
                            className="w-8 h-8 object-cover rounded"
                          />
                        ) : (
                          <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center text-xs">
                            📄
                          </div>
                        )}
                        <span className="font-medium break-all">{getFileName(file.key)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatSize(file.size)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatDate(file.uploaded)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div className="flex gap-2 justify-end">
                        <a
                          href={`/media/${file.key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          表示
                        </a>
                        <button
                          type="button"
                          className="text-red-600 dark:text-red-400 hover:underline"
                          onClick={() => handleDelete(file.key)}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
