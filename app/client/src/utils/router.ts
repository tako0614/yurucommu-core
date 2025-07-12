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

  const parseHash = () => {
    fromHash = true;
    const hash = globalThis.location.hash.slice(1);
    const [seg, rawParam] = hash.split("/").filter(Boolean);
    const param = rawParam ? decodeURIComponent(rawParam) : undefined;
    switch (seg) {
      case "chat":
        setApp("chat");
        setRoom(param ? handleToActor(param) : null);
        setPostId(null);
        setProfile(null);
        break;
      case "post":
        setApp("microblog");
        setPostId(param ?? null);
        setRoom(null);
        setProfile(null);
        break;
      case "user":
        setApp("home");
        setProfile(param ?? null);
        setRoom(null);
        setPostId(null);
        break;
      case "home":
      case "microblog":
      case "tools":
      case "videos":
        setApp(seg as AppPage);
        setRoom(null);
        setPostId(null);
        setProfile(null);
        break;
      default:
        setApp("chat");
        setRoom(null);
        setPostId(null);
        setProfile(null);
    }
    fromHash = false;
  };

  const updateHash = () => {
    if (fromHash) return;
    let newHash = "";
    if (app() === "chat") {
      newHash = room()
        ? `#/chat/${encodeURIComponent(actorToHandle(room()))}`
        : "#/chat";
    } else if (app() === "microblog") {
      newHash = postId() ? `#/post/${postId()}` : "#/microblog";
    } else if (app() === "home") {
      newHash = profile() ? `#/user/${profile()}` : "#/home";
    } else {
      newHash = `#/${app()}`;
    }
    if (globalThis.location.hash !== newHash) {
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
