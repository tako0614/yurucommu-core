import { createEffect, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import { AppPage, selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { profileUserState, selectedPostIdState } from "../states/router.ts";

// URL と状態を同期するパスベースのルーター

export function navigate(path: string) {
  history.pushState(null, "", path);
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathRouter() {
  const [app, setApp] = useAtom(selectedAppState);
  const [room, setRoom] = useAtom(selectedRoomState);
  const [postId, setPostId] = useAtom(selectedPostIdState);
  const [profile, setProfile] = useAtom(profileUserState);

  let fromPath = false;

  const setIfChanged = <T>(get: () => T, set: (v: T) => void, value: T) => {
    if (get() !== value) set(value);
  };

  const parsePath = () => {
    fromPath = true;
    const path = globalThis.location.pathname.slice(1);
    const [seg, rawParam] = path.split("/").filter(Boolean);
    const param = rawParam ? decodeURIComponent(rawParam) : undefined;
    switch (seg) {
      case "chat":
        setIfChanged(app, setApp, "chat");
        setIfChanged(room, setRoom, param ?? null);
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
        setIfChanged(app, setApp, "profile");
        setIfChanged(profile, setProfile, param ?? null);
        setIfChanged(room, setRoom, null);
        setIfChanged(postId, setPostId, null);
        break;
      case "home":
      case "microblog":
      case "tools":
      case "notifications":
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
    fromPath = false;
  };

  const normalizePath = (path: string) => {
    const [seg, rawParam] = path.slice(1).split("/").filter(Boolean);
    const param = rawParam ? decodeURIComponent(rawParam) : undefined;
    switch (seg) {
      case "chat":
        return param ? `/chat/${encodeURIComponent(param)}` : "/chat";
      case "post":
        return param ? `/post/${encodeURIComponent(param)}` : "/microblog";
      case "user":
        return param ? `/user/${encodeURIComponent(param)}` : "/profile";
      case undefined:
        return "/";
      default:
        return `/${seg}`;
    }
  };

  const updatePath = () => {
    if (fromPath) return;
    let newPath = "";
    if (app() === "chat") {
      newPath = room() ? `/chat/${encodeURIComponent(room()!)}` : "/chat";
    } else if (app() === "microblog") {
      newPath = postId()
        ? `/post/${encodeURIComponent(postId()!)}`
        : "/microblog";
    } else if (app() === "home") {
      newPath = "/home";
    } else if (app() === "profile") {
      newPath = profile()
        ? `/user/${encodeURIComponent(profile()!)}`
        : "/profile";
    } else {
      newPath = `/${app()}`;
    }
    if (normalizePath(globalThis.location.pathname) !== newPath) {
      history.pushState(null, "", newPath);
    }
  };

  onMount(() => {
    parsePath();
    globalThis.addEventListener("popstate", parsePath);
    return () => globalThis.removeEventListener("popstate", parsePath);
  });

  createEffect(updatePath);
}
