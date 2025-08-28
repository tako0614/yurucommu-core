import type { Context } from "hono";
import { createDB } from "./db/mod.ts";
import {
  createAcceptActivity,
  deliverActivityPubObject,
  extractAttachments,
  getDomain,
  iriToHandle,
} from "./utils/activitypub.ts";
import { broadcast, sendToUser } from "./routes/ws.ts";
import { formatUserInfoForPost, getUserInfo } from "./services/user-info.ts";
import { resolveRemoteActor } from "./utils/activitypub.ts";

export type ActivityHandler = (
  activity: Record<string, unknown>,
  username: string,
  c: unknown,
) => Promise<unknown>;

async function saveObject(
  env: Record<string, string>,
  obj: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  // 外部ユーザーの情報を抽出
  let actorInfo = {};
  if (typeof actor === "string" && actor.startsWith("http")) {
    // ActivityPubオブジェクトから追加のactor情報を試みる
    if (obj.attributedTo && typeof obj.attributedTo === "object") {
      const actorObj = obj.attributedTo as Record<string, unknown>;
      actorInfo = {
        name: actorObj.name,
        preferredUsername: actorObj.preferredUsername,
        icon: typeof actorObj.icon === "object" && actorObj.icon !== null
          ? (actorObj.icon as Record<string, unknown>).url
          : actorObj.icon,
        summary: actorObj.summary,
      };
    }
  }

  const attachments = extractAttachments(obj);
  const extra: Record<string, unknown> = {
    ...(obj.extra ?? {}),
    actorInfo: Object.keys(actorInfo).length > 0 ? actorInfo : undefined,
  };
  if (attachments.length > 0) extra.attachments = attachments;

  // attributedTo を URL として正規化する
  let attributedTo = actor;
  if (typeof obj.attributedTo === "string") {
    try {
      attributedTo = new URL(obj.attributedTo).href;
    } catch {
      try {
        attributedTo = new URL(actor).href;
      } catch {
        attributedTo = actor;
      }
    }
  } else {
    try {
      attributedTo = new URL(actor).href;
    } catch {
      attributedTo = actor;
    }
  }

  const db = createDB(env);
  return await db.posts.saveObject({
    type: obj.type ?? "Note",
    attributedTo,
    content: obj.content,
    to: Array.isArray(obj.to) ? obj.to : [],
    cc: Array.isArray(obj.cc) ? obj.cc : [],
    published: obj.published && typeof obj.published === "string"
      ? new Date(obj.published)
      : new Date(),
    raw: obj,
    extra,
  }) as unknown as Record<string, unknown>;
}

export const activityHandlers: Record<string, ActivityHandler> = {
  async Create(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    console.log("Handling Create activity");
    if (typeof activity.object !== "object" || activity.object === null) {
      return;
    }
    const obj = activity.object as Record<string, unknown>;
    // オブジェクトの宛先を収集
    const collect = (v: unknown): string[] => {
      const out: string[] = [];
      if (Array.isArray(v)) {
        for (const x of v) out.push(...collect(x));
      } else if (typeof v === "string") {
        out.push(v);
      }
      return out;
    };
    // obj.to は以降も使うので保持
    const toList = collect(obj.to);
    const ccList = collect((obj as { cc?: unknown }).cc);
    const btoList = collect((obj as { bto?: unknown }).bto);
    const bccList = collect((obj as { bcc?: unknown }).bcc);
    const audienceList = collect((obj as { audience?: unknown }).audience);

    const objectRecipients = [
      ...toList,
      ...ccList,
      ...btoList,
      ...bccList,
      ...audienceList,
    ];
    const extra = typeof obj.extra === "object" && obj.extra !== null
      ? obj.extra as Record<string, unknown>
      : {};

    // extra.dm が true または、オブジェクトの宛先が「単一のActorのみ（Public禁止）」の場合は DM とみなす
    const isCollection = (url: string): boolean => {
      if (url === "https://www.w3.org/ns/activitystreams#Public") return true;
      try {
        const path = new URL(url).pathname;
        return path.endsWith("/followers") ||
          path.endsWith("/following") ||
          path.endsWith("/outbox") ||
          path.endsWith("/collections") ||
          path.endsWith("/liked") ||
          path.endsWith("/likes");
      } catch {
        return false;
      }
    };

    const actor = typeof activity.actor === "string"
      ? activity.actor
      : username;
    // Public/コレクションを除外し、送信者自身も除外
    const recipientCandidates = Array.from(
      new Set(
        objectRecipients.filter((x): x is string => typeof x === "string"),
      ),
    ).filter((u) => !isCollection(u) && u !== actor);
    const inferredDmTarget = recipientCandidates.length === 1
      ? recipientCandidates[0]
      : undefined;
    console.log("inferredDmTarget:", inferredDmTarget);
    if (extra.dm === true || inferredDmTarget) {
      const target = inferredDmTarget ?? toList[0];
      if (!target || isCollection(target)) return;
      const env = (c as { get: (k: string) => unknown }).get("env") as Record<
        string,
        string
      >;
      const domain = getDomain(c as Context);
      const db = createDB(env);
      const msg = await db.posts.saveMessage(
        domain,
        actor,
        typeof obj.content === "string" ? obj.content : "",
        extra,
        { to: toList, cc: Array.isArray(obj.cc) ? obj.cc : [] },
      ) as { _id: unknown };

      const fromHandle = iriToHandle(actor);
      const toHandle = iriToHandle(target);
      // DM ルームを双方に作成（未作成時）
      try {
        const fromInfo = await getUserInfo(fromHandle, domain, env).catch(
          () => null,
        );
        const toInfo = await getUserInfo(toHandle, domain, env).catch(
          () => null,
        );
        await Promise.all([
          db.dms.create({
            owner: fromHandle,
            id: toHandle,
            name: toInfo?.displayName || toInfo?.userName || toHandle,
            icon: toInfo?.authorAvatar,
          }),
          db.dms.create({
            owner: toHandle,
            id: fromHandle,
            name: fromInfo?.displayName || fromInfo?.userName || fromHandle,
            icon: fromInfo?.authorAvatar,
          }),
        ]);
      } catch {
        /* ignore room creation errors */
      }
      const payload = {
        id: String(msg._id),
        from: fromHandle,
        to: toHandle,
        content: typeof obj.content === "string" ? obj.content : "",
      };
      sendToUser(toHandle, { type: "dm", payload });
      sendToUser(fromHandle, { type: "dm", payload });

      const targetHost = (() => {
        try {
          return new URL(target).hostname;
        } catch {
          return "";
        }
      })();
      if (targetHost && targetHost !== domain) {
        deliverActivityPubObject([target], activity, actor, domain, env).catch(
          (err) => {
            console.error("Delivery failed:", err);
          },
        );
      }
      return;
    }

    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const saved = await saveObject(
      env,
      obj,
      actor,
    );
    const domain = getDomain(c as Context);
    const userInfo = await getUserInfo(
      iriToHandle((saved.actor_id as string) ?? actor),
      domain,
      env,
    );
    const formatted = formatUserInfoForPost(
      userInfo,
      saved,
    );
    broadcast({
      type: "newPost",
      payload: { timeline: "latest", post: formatted },
    });
    sendToUser(`${username}@${domain}`, {
      type: "newPost",
      payload: { timeline: "following", post: formatted },
    });
  },

  async Follow(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    if (typeof activity.actor !== "string") return;
    const env = (c as { get: (k: string) => unknown }).get("env") as Record<
      string,
      string
    >;
    const db = createDB(env);
    await db.accounts.addFollowerByName(username, activity.actor);
    await db.posts.follow(username, activity.actor);
    const domain = getDomain(c as Context);
    const accept = createAcceptActivity(
      domain,
      `https://${domain}/users/${username}`,
      activity,
    );
    deliverActivityPubObject(
      [activity.actor],
      accept,
      username,
      domain,
      env,
    ).catch(
      (err) => {
        console.error("Delivery failed:", err);
      },
    );
  },

  async Invite(
    activity: Record<string, unknown>,
    username: string,
    c: unknown,
  ) {
    // 招待（グループ → ローカルユーザー）。通知を作成して WS で配信。
    try {
      const env = (c as { get: (k: string) => unknown }).get("env") as Record<
        string,
        string
      >;
      const db = createDB(env);
      const account = await db.accounts.findByUserName(username);
      if (!account) return;

      // group actor は activity.actor、フォールバックとして activity.target
      const groupActor = typeof activity.actor === "string"
        ? activity.actor
        : (typeof (activity as { target?: unknown }).target === "string"
          ? (activity as { target: string }).target
          : "");
      if (!groupActor) return;

      // 可能ならリモートアクター情報を取得して表示名等を補完（失敗しても続行）
      let displayName = "";
      let preferred = "";
      try {
        const doc = await resolveRemoteActor(groupActor, env);
        const res = await fetch(doc.id, {
          headers: {
            Accept:
              'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
          },
        });
        if (res.ok) {
          const actor = await res.json() as {
            name?: string;
            preferredUsername?: string;
          };
          displayName = actor.name ?? "";
          preferred = actor.preferredUsername ?? "";
        }
      } catch {
        /* ignore */
      }

      const groupName = preferred || (() => {
        try {
          const u = new URL(groupActor);
          return u.pathname.split("/").pop() || "";
        } catch {
          return "";
        }
      })();

      await db.notifications.create(
        (account as { _id: string })._id,
        "グループ招待",
        JSON.stringify({
          kind: "group-invite",
          groupId: groupActor,
          groupName,
          displayName: displayName || groupName || groupActor,
          inviter: groupActor,
        }),
        "group-invite",
      );
      const domain = getDomain(c as Context);
      sendToUser(`${username}@${domain}`, { type: "notification" });
    } catch (err) {
      console.error("Invite handler failed:", err);
    }
  },
};
