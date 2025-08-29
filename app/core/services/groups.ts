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
  let msgs = await db.posts.findMessages({ "aud.to": groupId }) as {
    _id?: string;
    actor_id?: string;
    attributedTo?: string;
    content?: string;
    extra?: Record<string, unknown>;
    url?: string;
    mediaType?: string;
    published?: Date;
  }[];
  if (opts.before) {
    const b = opts.before;
    msgs = msgs.filter((m) =>
      new Date(String(m.published)).getTime() < b.getTime()
    );
  }
  if (opts.after) {
    const a = opts.after;
    msgs = msgs.filter((m) =>
      new Date(String(m.published)).getTime() > a.getTime()
    );
  }
  msgs.sort((a, b) =>
    new Date(String(a.published)).getTime() -
    new Date(String(b.published)).getTime()
  );
  if (opts.limit && msgs.length > opts.limit) {
    msgs = msgs.slice(msgs.length - opts.limit);
  }
  return msgs.map((m) => ({
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
