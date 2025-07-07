// ユーザー/グループ情報をキャッシュするグローバルMap
import { DEFAULT_ICON } from "../../components/utils/defaultIcon";
import { TakosFetch } from "../TakosFetch";
const entityInfoCache = new Map<
  string,
  Promise<{ icon: string; nickName: string; type: "friend" | "group" }>
>();

/**
 * ユーザーまたはグループ情報を取得する関数
 * @param id ユーザーIDまたはグループID（完全なID: user@domain または group@domain）
 * @param domain ドメイン
 * @param type friendまたはgroup
 * @returns アイコンとニックネームを含むオブジェクトのPromise
 */
export async function TakosFetchEntityInfo(
  id: string,
  domain: string,
  type: "friend" | "group",
): Promise<{ icon: string; nickName: string; type: "friend" | "group" }> {
  // すでにキャッシュに存在する場合はそれを返す
  if (entityInfoCache.has(id)) {
    return entityInfoCache.get(id)!;
  }

  // 新しく取得処理を開始
  const TakosFetchPromise = (async () => {
    try {
      const endpoints = type === "friend"
        ? [`user/${id}/icon`, `user/${id}/nickName`]
        : [`group/${id}/icon`, `group/${id}/name`];

      // 並行して両方の情報を取得
      console.log(`https://${domain}/_takos/v1/${endpoints[0]}`);

      const [iconResponse, nameResponse] = await Promise.all([
        TakosFetch(`https://${domain}/_takos/v1/${endpoints[0]}`).then((res) =>
          res.json()
        ),
        TakosFetch(`https://${domain}/_takos/v1/${endpoints[1]}`).then((res) =>
          res.json()
        ),
      ]);
      const result = {
        icon: iconResponse.icon
          ? `data:image/png;base64,${iconResponse.icon}`
          : "",
        nickName: type === "friend" ? nameResponse.nickName : nameResponse.name,
        type,
      };

      return result;
    } catch (error) {
      console.error(`Failed to TakosFetch entity info for ${id}:`, error);
      return {
        icon: "",
        nickName: id,
        type,
      };
    }
  })();

  // キャッシュに保存
  entityInfoCache.set(id, TakosFetchPromise);

  return TakosFetchPromise;
}

/**
 * 複数のエンティティ情報を一括で取得する
 * @param ids エンティティIDの配列
 * @returns エンティティIDをキーとした情報オブジェクトのPromise
 */
export async function TakosFetchMultipleEntityInfo(
  ids: string[],
): Promise<
  Map<string, { icon: string; nickName: string; type: "friend" | "group" }>
> {
  const resultMap = new Map<
    string,
    { icon: string; nickName: string; type: "friend" | "group" }
  >();

  // 重複排除
  const uniqueIds = [...new Set(ids)];

  // グループ化して並列処理
  const promises = uniqueIds.map(async (id) => {
    if (id === "everyone") {
      resultMap.set(id, {
        icon: DEFAULT_ICON,
        nickName: "everyone",
        type: "friend",
      });
    } else {
      const domain = id.split("@")[1];
      const type = id.includes("group@") ? "group" : "friend";
      const info = await TakosFetchEntityInfo(id, domain, type);
      resultMap.set(id, info);
    }
  });

  await Promise.all(promises);
  return resultMap;
}

/**
 * キャッシュからエンティティ情報を取得
 * @param id エンティティID
 */
export function getCachedEntityInfo(id: string) {
  return entityInfoCache.get(id);
}

/**
 * キャッシュをクリア
 */
export function clearCache() {
  entityInfoCache.clear();
}

export default entityInfoCache;
