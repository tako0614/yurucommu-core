import type { DataStore } from "../db/types.ts";
import type { ListedGroup } from "@takos/types";

/** 指定ユーザーが所属するグループ一覧を取得します */
export function listGroups(
  db: DataStore,
  member: string,
): Promise<ListedGroup[]> {
  return db.groups.list(member);
}

interface MessageOpts {
  limit?: number;
  before?: Date;
  after?: Date;
}

/** グループのメッセージ一覧を取得します */
export async function listGroupMessages(
  db: DataStore,
  groupId: string,
  opts: MessageOpts,
): Promise<Record<string, unknown>[]> {
  try {
    console.log("[Group] listGroupMessages", {
      groupId,
      before: opts.before?.toISOString(),
      after: opts.after?.toISOString(),
      limit: opts.limit,
    });
  } catch { /* ignore */ }

  // Message と Note の双方を検索してマージ（aud.to によるグループ宛判定）
  const [msgsRaw, notesRaw] = await Promise.all([
    db.posts.findMessages({ "aud.to": groupId }) as Promise<{
      _id?: string;
      actor_id?: string;
      attributedTo?: string;
      content?: string;
      extra?: Record<string, unknown>;
      url?: string;
      mediaType?: string;
      published?: Date;
    }[]>,
    db.posts.findNotes({ "aud.to": groupId }) as Promise<{
      _id?: string;
      actor_id?: string;
      attributedTo?: string;
      content?: string;
      extra?: Record<string, unknown>;
      published?: Date;
    }[]>,
  ]);

  type Unified = {
    _id?: string;
    actor_id?: string;
    attributedTo?: string;
    content?: string;
    extra?: Record<string, unknown>;
    url?: string;
    mediaType?: string;
    published?: Date;
    __src?: "msg" | "note";
  };

  let unified: Unified[] = [
    ...msgsRaw.map((m) => ({ ...m, __src: "msg" as const })),
    ...notesRaw.map((n) => ({ ...n, __src: "note" as const })),
  ];

  // Message/Note の重複除去（同一アクター・同一本文・同一時刻は Message を優先）
  const seen = new Map<string, Unified>();
  for (const m of unified) {
    const key = [
      String(m.actor_id ?? m.attributedTo ?? ""),
      String(m.content ?? ""),
      new Date(String(m.published ?? "")).toISOString(),
    ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, m);
    } else {
      // prefer Message over Note
      if (existing.__src === "note" && m.__src === "msg") {
        seen.set(key, m);
      }
    }
  }
  unified = Array.from(seen.values());

  if (opts.before) {
    const b = opts.before;
    unified = unified.filter((m) =>
      new Date(String(m.published)).getTime() < b.getTime()
    );
  }
  if (opts.after) {
    const a = opts.after;
    unified = unified.filter((m) =>
      new Date(String(m.published)).getTime() > a.getTime()
    );
  }
  unified.sort((a, b) =>
    new Date(String(a.published)).getTime() -
    new Date(String(b.published)).getTime()
  );
  if (opts.limit && unified.length > opts.limit) {
    unified = unified.slice(unified.length - opts.limit);
  }
  try {
    console.log("[Group] listGroupMessages: result", {
      count: unified.length,
    });
  } catch { /* ignore */ }

  return unified.map((m) => ({
    id: m._id ?? "",
    from: m.actor_id ?? m.attributedTo ?? "",
    to: groupId,
    type: typeof m.extra?.type === "string" ? m.extra.type as string : "note",
    content: typeof m.content === "string" ? m.content : "",
    attachments: Array.isArray(m.extra?.attachments)
      ? m.extra.attachments as Record<string, unknown>[]
      : undefined,
    url: typeof m.url === "string" ? m.url : undefined,
    mediaType: typeof m.mediaType === "string" ? m.mediaType : undefined,
    key: typeof m.extra?.key === "string" ? m.extra.key as string : undefined,
    iv: typeof m.extra?.iv === "string" ? m.extra.iv as string : undefined,
    preview: (m.extra?.preview && typeof m.extra.preview === "object")
      ? m.extra.preview as Record<string, unknown>
      : undefined,
    createdAt: m.published ?? new Date(),
  }));
}

/** グループ宛メッセージを保存します */
export function saveGroupMessage(
  db: DataStore,
  domain: string,
  fromUser: string,
  content: string,
  extra: Record<string, unknown>,
  groupId: string,
): Promise<{ _id?: string; published?: Date }> {
  return db.posts.saveMessage(
    domain,
    `https://${domain}/users/${fromUser}`,
    content,
    extra,
    { to: [groupId], cc: [] },
  ) as Promise<{ _id?: string; published?: Date }>;
}
