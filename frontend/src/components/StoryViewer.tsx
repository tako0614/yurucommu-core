import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";

import { deleteStory, updateStory, type Story } from "../lib/stories";
import StoryCanvas from "./StoryCanvas";
import Avatar from "./Avatar";
import StoryViewerController, {
  type StoryViewerSnapshot,
} from "@platform/stories/story-viewer-controller";
import { isCanvasExtensionSlide } from "@takos/platform";

type UserSummary = {
  id?: string;
  display_name?: string;
  avatar_url?: string;
};

type Props = {
  stories: Story[];
  startIndex: number;
  onClose: () => void;
  onUpdated?: (stories: Story[]) => void;
  myId?: string;
  author?: UserSummary | null;
};

const MENU_BUTTON =
  "w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center";

export default function StoryViewer(props: Props) {
  const controller = new StoryViewerController({
    stories: props.stories as any,
    startIndex: props.startIndex,
    viewerUserId: props.myId ?? null,
    fallbackAuthorId: props.author?.id ?? null,
  });

  const [state, setState] = createSignal<StoryViewerSnapshot>(
    controller.getSnapshot(),
  );
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [extending, setExtending] = createSignal(false);

  const unsubscribe = controller.subscribe((snapshot: any) => setState(snapshot));
  onCleanup(() => {
    unsubscribe();
    controller.destroy();
  });

  createEffect(() => {
    controller.setStories(props.stories as any);
  });

  createEffect(() => {
    controller.setIndex(props.startIndex);
    controller.resetProgress();
  });

  createEffect(() => {
    controller.setViewerUserId(props.myId ?? null);
  });

  createEffect(() => {
    controller.setFallbackAuthorId(props.author?.id ?? null);
  });

  createEffect(() => {
    const handler = (stories: any[]) => props.onUpdated?.(stories);
    const off = controller.onStoriesUpdated(handler);
    onCleanup(off);
  });

  createEffect(() => {
    const off = controller.onSequenceEnd(() => {
      props.onClose();
    });
    onCleanup(off);
  });

  createEffect(() => {
    controller.resume("visibility");
    onCleanup(() => controller.pause("visibility"));
  });

  createEffect(() => {
    controller.setPaused(menuOpen(), "menu");
  });

  let lastStoryId: string | null = null;
  createEffect(() => {
    const currentId = state().currentStory?.id ?? null;
    if (currentId !== lastStoryId) {
      lastStoryId = currentId;
      setMenuOpen(false);
    }
  });

  const isOwnStory = () => state().isOwnStory;
  const deleting = () => state().isDeleting;
  const index = () => Math.min(state().index, Math.max(0, state().total - 1));
  const total = () => state().total;
  const progress = () => state().progress;
  const storiesForProgress = () => state().stories;
  const currentStory = () => state().currentStory;
  const currentItem = () => state().currentItem;

  const formattedCreatedAt = createMemo(() => {
    const story = currentStory();
    if (!story) return "";
    try {
      return new Date(story.created_at).toLocaleString();
    } catch {
      return story.created_at || "";
    }
  });

  const media = createMemo(() => {
    const item: any = currentItem();
    if (!item) return null;
    if (item.type === "image") {
      return <img src={item.url} class="w-full h-full object-contain" />;
    }
    if (item.type === "video") {
      return (
        <video src={item.url} class="w-full h-full" autoplay muted controls />
      );
    }
    if (item.type === "text") {
      return (
        <div
          class="w-full h-full flex items-center justify-center px-8"
          style={{
            color: item.color || "#fff",
            "background-color": item.backgroundColor || "#000",
            "font-family": item.fontFamily || "inherit",
            "font-weight": item.fontWeight ? String(item.fontWeight) : "600",
          }}
        >
          <p
            class="text-2xl leading-snug whitespace-pre-wrap break-words w-full"
            style={{
              color: item.color || "#fff",
              "text-align": item.align || "center",
            }}
          >
            {item.text}
          </p>
        </div>
      );
    }
    if (item.type === "extension") {
      if (isCanvasExtensionSlide(item)) {
        return (
          <div class="w-full h-full flex items-center justify-center">
            <StoryCanvas data={item.payload.canvas} class="w-full h-full" />
          </div>
        );
      }
      return (
        <div class="w-full h-full flex items-center justify-center text-white/70 text-sm px-8 text-center">
          拡張スライド ({item.extensionType}) は未対応です。
        </div>
      );
    }
    return null;
  });

  const authorName = createMemo(
    () => props.author?.display_name || "ストーリー",
  );

  const authorAvatar = createMemo(() => props.author?.avatar_url || "");

  const handleDelete = async () => {
    const story = currentStory();
    if (!story || !isOwnStory() || deleting()) return;
    if (!window.confirm("このストーリーを削除しますか？この操作は元に戻せません。")) return;
    setMenuOpen(false);
    try {
      await controller.deleteCurrent(async (storyToDelete: any) => {
        await deleteStory(storyToDelete.id);
      });
    } catch (error: any) {
      window.alert(error?.message || "ストーリーを削除できませんでした。");
    }
  };

  const handleExtend = async () => {
    const story = currentStory();
    if (!story || !isOwnStory() || extending()) return;
    setExtending(true);
    try {
      await updateStory(story.id, { extendHours: 24 });
      window.alert("公開期限を24時間延長しました。");
    } catch (error: any) {
      window.alert(error?.message || "ストーリーを更新できませんでした。");
    } finally {
      setExtending(false);
      setMenuOpen(false);
    }
  };

  const next = () => {
    setMenuOpen(false);
    controller.next();
  };

  const prev = () => {
    setMenuOpen(false);
    controller.previous();
  };

  const totalDisplay = createMemo(() => {
    const value = total();
    if (value > 0) return value;
    return props.stories.length;
  });

  const indexDisplay = createMemo(() => {
    const totalValue = totalDisplay();
    if (totalValue <= 0) return 0;
    return Math.min(index() + 1, totalValue);
  });

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          controller.pause("visibility");
          props.onClose();
        }
      }}
    >
      <div
        class="relative w-full max-w-[420px] aspect-[1080/1920] rounded-[32px] bg-black overflow-hidden shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen(false);
        }}
      >
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="w-full h-full flex items-center justify-center">{media()}</div>
        </div>

        <div class="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none" />
        <div class="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

        <div class="absolute top-4 left-4 right-4 space-y-3">
          <div class="flex gap-1">
            <For each={storiesForProgress()}>
              {(_, i) => (
                <div class="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    class="h-full bg-white"
                    style={{
                      width:
                        i() < index()
                          ? "100%"
                          : i() > index()
                          ? "0%"
                          : `${Math.min(100, Math.floor(progress() * 100))}%`,
                    }}
                  />
                </div>
              )}
            </For>
          </div>

          <div class="flex items-center justify-between text-white">
            <div class="flex items-center gap-3">
              <Avatar
                src={authorAvatar()}
                alt="作者"
                class="w-10 h-10 rounded-full shrink-0 border border-white/30"
              />
              <div class="flex flex-col text-sm leading-tight">
                <span class="font-semibold">{authorName()}</span>
                <span class="text-white/70 text-xs">{formattedCreatedAt()}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-white/60">
                {indexDisplay()} / {totalDisplay()}
              </span>
              <Show when={isOwnStory()}>
                <div class="relative">
                  <button
                    class={MENU_BUTTON}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen((open) => !open);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen() ? "true" : "false"}
                    aria-label="その他の操作"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </button>
                  <Show when={menuOpen()}>
                    <div
                      class="absolute right-0 mt-2 w-40 rounded-2xl bg-black/85 backdrop-blur border border-white/10 shadow-lg py-2"
                    >
                      <button
                        class="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 flex items-center gap-2 disabled:opacity-60"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleExtend();
                        }}
                        disabled={extending()}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M12 8v4l3 3" />
                          <circle cx="12" cy="12" r="9" />
                        </svg>
                        <span>{extending() ? "延長中…" : "24時間延長"}</span>
                      </button>
                      <button
                        class="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete();
                        }}
                        disabled={deleting()}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m3 6 3 16h12l3-16" />
                          <path d="M2 6h20" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M8 6V4h8v2" />
                        </svg>
                        <span>{deleting() ? "削除中..." : "削除"}</span>
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
              <button
                class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                onClick={() => {
                  controller.pause("visibility");
                  props.onClose();
                }}
                aria-label="閉じる"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <button
          class="absolute top-16 bottom-32 left-0 w-1/4"
          onClick={prev}
          aria-label="前のストーリー"
        />
        <button
          class="absolute top-16 bottom-32 right-0 w-1/4"
          onClick={next}
          aria-label="次のストーリー"
        />

        <div class="absolute inset-x-4 bottom-6">
          <div class="flex items-center gap-3 text-white/90 text-sm rounded-2xl bg-white/10 backdrop-blur px-4 py-3">
            <div class="flex-1">
              現在ストーリーへの返信・リアクションは未対応です。近日アップデート予定です。
            </div>
            <button
              class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
              onClick={() => props.onClose()}
              aria-label="閉じる"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
