import { createEffect, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import { AppPage, selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { profileUserState, selectedPostIdState } from "../states/router.ts";
import { getDomain, getOrigin } from "./config.ts";

function actorToHandle(actor: string): string {
  if (actor.startsWith("http")) {
    try {
      const url = new URL(actor);
      const name = url.pathname.split("/").pop() ?? "";
      return `${name}@${url.hostname}`;
    } catch {
      return actor;
    }
  }
  if (actor.includes("@")) return actor;
  return `${actor}@${getDomain()}`;
}

function handleToActor(handle: string): string {
  if (handle.startsWith("http")) return handle;
  if (handle.includes("@")) {
    const [name, domain] = handle.split("@");
    return `https://${domain}/users/${name}`;
  }
  return `${getOrigin()}/users/${handle}`;
}

export function useHashRouter() {
  const [app, setApp] = useAtom(selectedAppState);
  const [room, setRoom] = useAtom(selectedRoomState);
  const [postId, setPostId] = useAtom(selectedPostIdState);
  const [profile, setProfile] = useAtom(profileUserState);

  let fromHash = false;

  const setIfChanged = <T>(get: () => T, set: (v: T) => void, value: T) => {
    if (get() !== value) set(value);
  };

  const parseHash = () => {
    fromHash = true;
    const hash = globalThis.location.hash.slice(1);
    const [seg, rawParam] = hash.split("/").filter(Boolean);
    const param = rawParam ? decodeURIComponent(rawParam) : undefined;
    switch (seg) {
      case "chat":
        setIfChanged(app, setApp, "chat");
        setIfChanged(room, setRoom, param ? handleToActor(param) : null);
        setIfChanged(postId, setPostId, null);
        setIfChanged(profile, setProfile, null);
        break;
      case "post":
        setIfChanged(app, setApp, "microblog");
        setIfChanged(postId, setPostId, param ?? null);
        setIfChanged(room, setRoom, null);
        setIfChanged(profile, setProfile, null);
        break;
      case "user":
        setIfChanged(app, setApp, "home");
        setIfChanged(profile, setProfile, param ?? null);
        setIfChanged(room, setRoom, null);
        setIfChanged(postId, setPostId, null);
        break;
      case "home":
      case "microblog":
      case "tools":
      case "videos":
        setIfChanged(app, setApp, seg as AppPage);
        setIfChanged(room, setRoom, null);
        setIfChanged(postId, setPostId, null);
        setIfChanged(profile, setProfile, null);
        break;
      default:
        setIfChanged(app, setApp, "chat");
        setIfChanged(room, setRoom, null);
        setIfChanged(postId, setPostId, null);
        setIfChanged(profile, setProfile, null);
    }
    fromHash = false;
  };

  const normalizeHash = (hash: string) => {
    const [seg, rawParam] = hash.slice(1).split("/").filter(Boolean);
    const param = rawParam ? decodeURIComponent(rawParam) : undefined;
    switch (seg) {
      case "chat":
        return param ? `#/chat/${encodeURIComponent(param)}` : "#/chat";
      case "post":
        return param ? `#/post/${encodeURIComponent(param)}` : "#/microblog";
      case "user":
        return param ? `#/user/${encodeURIComponent(param)}` : "#/home";
      case undefined:
        return "";
      default:
        return `#/${seg}`;
    }
  };

  const updateHash = () => {
    if (fromHash) return;
    let newHash = "";
    if (app() === "chat") {
      newHash = room()
        ? `#/chat/${encodeURIComponent(actorToHandle(room()))}`
        : "#/chat";
    } else if (app() === "microblog") {
      newHash = postId()
        ? `#/post/${encodeURIComponent(postId()!)}`
        : "#/microblog";
    } else if (app() === "home") {
      newHash = profile()
        ? `#/user/${encodeURIComponent(profile()!)}`
        : "#/home";
    } else {
      newHash = `#/${app()}`;
    }
    if (normalizeHash(globalThis.location.hash) !== newHash) {
      globalThis.location.hash = newHash;
    }
  };

  onMount(() => {
    parseHash();
    globalThis.addEventListener("hashchange", parseHash);
    return () => globalThis.removeEventListener("hashchange", parseHash);
  });

  createEffect(updateHash);
}
