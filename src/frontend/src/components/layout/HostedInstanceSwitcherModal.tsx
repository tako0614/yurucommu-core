import { useState } from 'react';
import type { HostedInstance } from '../../hooks/useAuth';

interface HostedInstanceSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  instances: HostedInstance[];
  currentInstanceId: string | null;
  onSelectInstance: (instanceId: string) => Promise<void> | void;
  onCreateInstance: (username: string) => Promise<boolean>;
  onRebuildInstance: (instanceId: string) => Promise<boolean> | void;
}

const usernamePattern = /^[a-z0-9][a-z0-9-]{2,29}$/;

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '稼働中';
    case 'provisioning':
      return '作成中';
    case 'pending':
      return '準備中';
    case 'failed':
      return '失敗';
    case 'missing':
      return '削除済み';
    default:
      return status;
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/20 text-green-300';
    case 'provisioning':
    case 'pending':
      return 'bg-blue-500/20 text-blue-300';
    case 'failed':
      return 'bg-red-500/20 text-red-300';
    case 'missing':
      return 'bg-amber-500/20 text-amber-300';
    default:
      return 'bg-neutral-700 text-neutral-200';
  }
}

export function HostedInstanceSwitcherModal({
  isOpen,
  onClose,
  instances,
  currentInstanceId,
  onSelectInstance,
  onCreateInstance,
  onRebuildInstance,
}: HostedInstanceSwitcherModalProps) {
  const [username, setUsername] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    const value = username.trim().toLowerCase();
    if (!value) {
      setCreateError('ユーザー名を入力してください');
      return;
    }
    if (!usernamePattern.test(value)) {
      setCreateError('ユーザー名は3-30文字の小文字英数字とハイフンのみ使用できます');
      return;
    }
    setCreateError(null);
    setCreating(true);
    const success = await onCreateInstance(value);
    setCreating(false);
    if (success) {
      setUsername('');
    } else {
      setCreateError('作成に失敗しました');
    }
  };

  const handleSelect = async (instanceId: string) => {
    if (instanceId === currentInstanceId) return;
    setSwitchingId(instanceId);
    await onSelectInstance(instanceId);
    setSwitchingId(null);
    onClose();
  };

  const handleRebuild = async (instanceId: string) => {
    setRebuildingId(instanceId);
    await onRebuildInstance(instanceId);
    setRebuildingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-neutral-900 rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 className="text-lg font-semibold">インスタンス</h2>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {instances.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              まだインスタンスがありません
            </div>
          ) : (
            <div className="py-2">
              {instances.map((instance) => {
                const isCurrent = instance.id === currentInstanceId;
                const statusLabel = getStatusLabel(instance.status);
                return (
                  <div
                    key={instance.id}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${
                      isCurrent ? 'bg-neutral-800/60' : 'hover:bg-neutral-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{instance.subdomain}.yurucommu.com</div>
                      <div className="text-sm text-neutral-500 truncate">@{instance.username}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${getStatusClass(instance.status)}`}>
                        {statusLabel}
                      </span>
                      {instance.status === 'missing' && (
                        <button
                          onClick={() => handleRebuild(instance.id)}
                          disabled={rebuildingId === instance.id}
                          className="text-xs px-2 py-1 rounded-full border border-amber-400/60 text-amber-200 hover:bg-amber-400/10 disabled:opacity-60"
                        >
                          {rebuildingId === instance.id ? '再作成中...' : '再作成'}
                        </button>
                      )}
                      {isCurrent ? (
                        <span className="text-xs text-neutral-400">選択中</span>
                      ) : (
                        <button
                          onClick={() => handleSelect(instance.id)}
                          disabled={switchingId === instance.id}
                          className="text-xs px-2 py-1 rounded-full border border-neutral-600 text-neutral-200 hover:bg-neutral-800 disabled:opacity-60"
                        >
                          {switchingId === instance.id ? '切替中...' : '切替'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-neutral-800 p-4">
          <div className="text-sm text-neutral-400 mb-2">新しいインスタンス</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={creating}
            />
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? '作成中...' : '作成'}
            </button>
          </div>
          {createError && (
            <div className="mt-2 text-sm text-red-400">{createError}</div>
          )}
        </div>
      </div>
    </div>
  );
}
