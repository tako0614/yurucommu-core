import { Show } from "solid-js";

export interface PackageInfo {
  identifier: string;
  name: string;
  version: string;
  description?: string;
  downloadUrl: string;
  sha256?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PackageCardProps {
  package: PackageInfo;
  onInstall?: (pkg: PackageInfo) => void;
  onViewDetails?: (pkg: PackageInfo) => void;
}

export default function PackageCard(props: PackageCardProps) {
  const getInitials = (name: string) => {
    return name
      .split(/[\s.-]/)
      .map((word) => word.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("ja-JP");
    } catch {
      return "";
    }
  };

  const getDomainFromIdentifier = (identifier: string) => {
    const parts = identifier.split(".");
    return parts.length > 1 ? parts.slice(-2).join(".") : identifier;
  };

  return (
    <div class="group bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 hover:border-purple-500/30 hover:bg-gray-800/70 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10 animate-fade-in">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center space-x-3">
          <div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-semibold text-lg shadow-lg">
            {getInitials(props.package.name)}
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold text-gray-100 truncate group-hover:text-purple-300 transition-colors">
              {props.package.name}
            </h3>
            <p class="text-sm text-gray-400 truncate">
              {props.package.identifier}
            </p>
          </div>
        </div>
        <div class="flex flex-col items-end space-y-1">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
            v{props.package.version}
          </span>
          <span class="text-xs text-gray-500">
            {getDomainFromIdentifier(props.package.identifier)}
          </span>
        </div>
      </div>

      <Show when={props.package.description}>
        <p class="text-gray-300 text-sm leading-relaxed mb-4 line-clamp-2">
          {props.package.description}
        </p>
      </Show>

      <div class="flex items-center justify-between pt-4 border-t border-gray-700/50">
        <div class="flex items-center space-x-4 text-xs text-gray-500">
          <Show when={props.package.updatedAt}>
            <span class="flex items-center space-x-1">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{formatDate(props.package.updatedAt)}</span>
            </span>
          </Show>
          <Show when={props.package.sha256}>
            <span class="flex items-center space-x-1">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>検証済み</span>
            </span>
          </Show>
        </div>

        <div class="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => props.onViewDetails?.(props.package)}
            class="px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors duration-200"
          >
            詳細
          </button>{" "}
          <button
            type="button"
            onClick={() => props.onInstall?.(props.package)}
            class="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md"
          >
            インストール
          </button>
        </div>
      </div>
    </div>
  );
}
