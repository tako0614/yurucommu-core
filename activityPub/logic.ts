import { Story } from "./user.ts";
import { btos, stob } from "./utils.ts";

async function getInbox(req: string) {
    const res = await fetch(req, {
        method: "GET",
        headers: { Accept: "application/activity+json" },
    });
    return res.json();
}

async function postInbox(
    req: string,
    data: any,
    headers: { [key: string]: string },
) {
    const res = await fetch(req, {
        method: "POST",
        body: JSON.stringify(data),
        headers,
    });
    return res;
}

async function signHeaders(
    res: any,
    strName: string,
    strHost: string,
    strInbox: string,
    privateKey: CryptoKey,
) {
    const strTime = new Date().toUTCString();
    const s = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(res)),
    );
    const s256 = btoa(btos(s));
    const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        privateKey,
        stob(
            `(request-target): post ${new URL(strInbox).pathname}\n` +
                `host: ${new URL(strInbox).hostname}\n` +
                `date: ${strTime}\n` +
                `digest: SHA-256=${s256}`,
        ),
    );
    const b64 = btoa(btos(sig));
    const headers = {
        Host: new URL(strInbox).hostname,
        Date: strTime,
        Digest: `SHA-256=${s256}`,
        Signature: `keyId="https://${strHost}/u/${strName}",` +
            `algorithm="rsa-sha256",` +
            `headers="(request-target) host date digest",` +
            `signature="${b64}"`,
        Accept: "application/activity+json",
        "Content-Type": "application/activity+json",
        "Accept-Encoding": "gzip",
        "User-Agent": `Minidon/0.0.0 (+https://${strHost}/)`,
    };
    return headers;
}

async function acceptFollow(
    strName: string,
    strHost: string,
    x: any,
    y: any,
    privateKey: CryptoKey,
) {
    const strId = crypto.randomUUID();
    const strInbox = x.inbox;
    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${strName}/s/${strId}`,
        type: "Accept",
        actor: `https://${strHost}/u/${strName}`,
        object: y,
    };
    const headers = await signHeaders(
        res,
        strName,
        strHost,
        strInbox,
        privateKey,
    );
    await postInbox(strInbox, res, headers);
}

async function createNote(
    strId: string,
    username: string,
    strHost: string,
    x: any,
    y: string,
    privateKey: CryptoKey,
    attachements?: { type: string; url: string }[],
) {
    const strTime = new Date().toISOString().substring(0, 19) + "Z";
    const strInbox = x.inbox;
    console.log(attachements, "attachements");
    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${username}/s/${strId}/activity`,
        type: "Create",
        actor: `https://${strHost}/u/${username}`,
        published: strTime,
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [`https://${strHost}/u/${username}/followers`],
        object: {
            id: `https://${strHost}/u/${username}/s/${strId}`,
            type: "Note",
            attributedTo: `https://${strHost}/u/${username}`,
            content: y,
            url: `https://${strHost}/u/${username}/s/${strId}`,
            published: strTime,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: [`https://${strHost}/u/${username}/followers`],
            attachment: attachements,
        },
    };
    const headers = await signHeaders(
        res,
        username,
        strHost,
        strInbox,
        privateKey,
    );
    await postInbox(strInbox, res, headers);
}

async function deleteNote(
    username: string,
    strHost: string,
    x: any,
    y: string,
    privateKey: CryptoKey,
) {
    const strId = crypto.randomUUID();
    const strInbox = x.inbox;
    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${username}/s/${strId}/activity`,
        type: "Delete",
        actor: `https://${strHost}/u/${username}`,
        object: {
            id: y,
            type: "Note",
        },
    };
    const headers = await signHeaders(
        res,
        username,
        strHost,
        strInbox,
        privateKey,
    );
    await postInbox(strInbox, res, headers);
}

async function createLike(
    strId: string,
    username: string,
    strHost: string,
    x: any, // 相手のアクターオブジェクト
    targetId: string, // いいねする投稿のID
    privateKey: CryptoKey,
) {
    const strTime = new Date().toISOString();
    const strInbox = x.inbox;

    // Likeアクティビティを作成
    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${username}/like/${strId}`,
        type: "Like",
        actor: `https://${strHost}/u/${username}`,
        object: targetId,
        published: strTime,
    };

    const headers = await signHeaders(
        res,
        username,
        strHost,
        strInbox,
        privateKey,
    );

    return await postInbox(strInbox, res, headers);
}

async function undoLike(
    strId: string,
    username: string,
    strHost: string,
    x: any,
    likeId: string,
    targetId: string,
    privateKey: CryptoKey,
) {
    const strInbox = x.inbox;

    // Undoアクティビティを作成
    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${username}/undo/${strId}`,
        type: "Undo",
        actor: `https://${strHost}/u/${username}`,
        object: {
            id: likeId,
            type: "Like",
            actor: `https://${strHost}/u/${username}`,
            object: targetId,
        },
    };

    const headers = await signHeaders(
        res,
        username,
        strHost,
        strInbox,
        privateKey,
    );

    return await postInbox(strInbox, res, headers);
}

async function createStory(
    strId: string,
    username: string,
    strHost: string,
    x: any,
    mediaUrl: string | null,
    mediaType: string | null,
    expiresAt: string,
    privateKey: CryptoKey,
) {
    const strTime = new Date().toISOString();
    const strInbox = x.inbox;

    // ストーリーオブジェクトを作成
    const storyObject: Story = {
        id: `https://${strHost}/u/${username}/story/${strId}`,
        type: "Story",
        attributedTo: `https://${strHost}/u/${username}`,
        published: strTime,
        expiresAt: expiresAt,
        to: [`https://${strHost}/u/${username}/followers`],
        cc: [],
        url: `https://${strHost}/u/${username}/story/${strId}`,
        mediaType: "Image",
    };

    // メディアURLとタイプがある場合は追加
    if (mediaUrl && mediaType) {
        storyObject.mediaType = mediaType;
        storyObject.attachment = [
            {
                type: "Document",
                mediaType: mediaType,
                url: mediaUrl,
            },
        ];
    }

    const res = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://${strHost}/u/${username}/story/${strId}/activity`,
        type: "Create",
        actor: `https://${strHost}/u/${username}`,
        published: strTime,
        to: [`https://${strHost}/u/${username}/followers`],
        cc: [],
        object: storyObject,
    };

    const headers = await signHeaders(
        res,
        username,
        strHost,
        strInbox,
        privateKey,
    );

    return await postInbox(strInbox, res, headers);
}

/**
 * ハンドル（username@domain）からユーザーのアクター情報を取得する
 */
async function getActorByHandle(handle: string): Promise<any> {
    // handleをusernameとdomainに分割
    const [username, domain] = handle.split("@");
    if (!username || !domain) {
        throw new Error("Invalid handle format. Expected username@domain");
    }

    // WebFingerエンドポイントにリクエスト
    const webfingerUrl =
        `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;

    const webfingerRes = await fetch(webfingerUrl);
    if (!webfingerRes.ok) {
        throw new Error(
            `WebFinger request failed: ${webfingerRes.status} ${webfingerRes.statusText}`,
        );
    }
    const webfingerData = await webfingerRes.json();

    // アクターURLを見つける
    const actorLink = webfingerData.links.find((link: any) =>
        link.rel === "self" && link.type === "application/activity+json"
    );

    if (!actorLink || !actorLink.href) {
        throw new Error("Actor URL not found in WebFinger response");
    }

    // アクター情報を取得
    const actorUrl = actorLink.href;
    const actorRes = await fetch(actorUrl, {
        headers: { Accept: "application/activity+json" },
    });

    if (!actorRes.ok) {
        throw new Error(
            `Failed to fetch actor data: ${actorRes.status} ${actorRes.statusText}`,
        );
    }

    return (await actorRes.json()).id;
}

export {
    acceptFollow,
    createLike,
    createNote,
    createStory,
    deleteNote,
    getActorByHandle,
    getInbox,
    postInbox,
    signHeaders,
    undoLike,
};
