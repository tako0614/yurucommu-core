// createTakosApp から渡された環境変数を保持する
let currentEnv: Record<string, string> = {};

// 環境変数を初期化する
export function initEnv(env: Record<string, string>) {
  currentEnv = env;
}

// 保持している環境変数を取得する
export function getEnv(): Record<string, string> {
  return currentEnv;
}
