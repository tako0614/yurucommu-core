/**
 * Usage Tracker
 *
 * KV ストレージを使用してプラン制限の使用量を追跡
 *
 * キー構造:
 * - usage:{userId}:ai:{month} - AI リクエスト数（月ごと）
 * - usage:{userId}:dm:{day} - DM メッセージ数（日ごと）
 * - usage:{userId}:ap:minute:{minute} - AP 配信数（分ごと）
 * - usage:{userId}:ap:day:{day} - AP 配信数（日ごと）
 */

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

const MONTH_TTL = 32 * 24 * 60 * 60; // 32 days
const DAY_TTL = 25 * 60 * 60; // 25 hours
const MINUTE_TTL = 2 * 60; // 2 minutes

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

const getCurrentDay = () => {
  const now = new Date();
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
};

const getCurrentMinute = () => {
  const now = new Date();
  return `${getCurrentDay()}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
};

export interface UsageTracker {
  /**
   * AI リクエスト使用量を取得
   */
  getAiUsage(userId: string): Promise<number>;

  /**
   * AI リクエストを記録
   */
  recordAiRequest(userId: string, count?: number): Promise<number>;

  /**
   * DM メッセージ使用量を取得（日ごと）
   */
  getDmUsage(userId: string): Promise<number>;

  /**
   * DM メッセージを記録
   */
  recordDmMessage(userId: string, count?: number): Promise<number>;

  /**
   * AP 配信使用量を取得
   */
  getApDeliveryUsage(userId: string): Promise<{ minute: number; day: number }>;

  /**
   * AP 配信を記録
   */
  recordApDelivery(userId: string, count?: number): Promise<{ minute: number; day: number }>;
}

/**
 * KV ベースの UsageTracker を作成
 */
export function createUsageTracker(kv: KVNamespace | null | undefined): UsageTracker {
  const getCount = async (key: string): Promise<number> => {
    if (!kv) return 0;
    const value = await kv.get(key);
    return value ? parseInt(value, 10) || 0 : 0;
  };

  const increment = async (key: string, ttl: number, amount: number = 1): Promise<number> => {
    if (!kv) return amount;
    const current = await getCount(key);
    const newValue = current + amount;
    await kv.put(key, String(newValue), { expirationTtl: ttl });
    return newValue;
  };

  return {
    async getAiUsage(userId: string): Promise<number> {
      const key = `usage:${userId}:ai:${getCurrentMonth()}`;
      return getCount(key);
    },

    async recordAiRequest(userId: string, count: number = 1): Promise<number> {
      const key = `usage:${userId}:ai:${getCurrentMonth()}`;
      return increment(key, MONTH_TTL, count);
    },

    async getDmUsage(userId: string): Promise<number> {
      const key = `usage:${userId}:dm:${getCurrentDay()}`;
      return getCount(key);
    },

    async recordDmMessage(userId: string, count: number = 1): Promise<number> {
      const key = `usage:${userId}:dm:${getCurrentDay()}`;
      return increment(key, DAY_TTL, count);
    },

    async getApDeliveryUsage(userId: string): Promise<{ minute: number; day: number }> {
      const minuteKey = `usage:${userId}:ap:minute:${getCurrentMinute()}`;
      const dayKey = `usage:${userId}:ap:day:${getCurrentDay()}`;
      const [minute, day] = await Promise.all([getCount(minuteKey), getCount(dayKey)]);
      return { minute, day };
    },

    async recordApDelivery(userId: string, count: number = 1): Promise<{ minute: number; day: number }> {
      const minuteKey = `usage:${userId}:ap:minute:${getCurrentMinute()}`;
      const dayKey = `usage:${userId}:ap:day:${getCurrentDay()}`;
      const [minute, day] = await Promise.all([
        increment(minuteKey, MINUTE_TTL, count),
        increment(dayKey, DAY_TTL, count),
      ]);
      return { minute, day };
    },
  };
}

/**
 * 環境変数から UsageTracker を作成
 */
export function createUsageTrackerFromEnv(env: Record<string, unknown>): UsageTracker {
  const kv = env.APP_STATE as KVNamespace | undefined;
  return createUsageTracker(kv);
}
