import { useEffect, useMemo, useRef, useState } from "react";
import { deleteStory, updateStory, type Story } from "../lib/stories";
import StoryCanvas from "./StoryCanvas";
import Avatar from "./Avatar";
import StoryViewerController, { type StoryViewerSnapshot } from "@platform/stories/story-viewer-controller";
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

const MENU_BUTTON = "w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center";

export default function StoryViewer(props: Props) {
  const controllerRef = useRef<StoryViewerController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new StoryViewerController({
      stories: props.stories as any,
      startIndex: props.startIndex,
      viewerUserId: props.myId ?? null,
      fallbackAuthorId: props.author?.id ?? null,
    });
  }
  const controller = controllerRef.current;

  const [state, setState] = useState<StoryViewerSnapshot>(controller.getSnapshot());
  const [menuOpen, setMenuOpen] = useState(false);
  const [extending, setExtending] = useState(false);
  const lastStoryIdRef = useRef<string | null>(state.currentStory?.id ?? null);

  useEffect(() => {
    const unsubscribe = controller.subscribe((snapshot: any) => setState(snapshot));
    return () => unsubscribe();
  }, [controller]);

  useEffect(() => {
    controller.setStories(props.stories as any);
  }, [controller, props.stories]);

  useEffect(() => {
    controller.setIndex(props.startIndex);
    controller.resetProgress();
  }, [controller, props.startIndex]);

  useEffect(() => {
    controller.setViewerUserId(props.myId ?? null);
  }, [controller, props.myId]);

  useEffect(() => {
    controller.setFallbackAuthorId(props.author?.id ?? null);
  }, [controller, props.author?.id]);

  useEffect(() => {
    const off = controller.onStoriesUpdated((stories: any[]) => props.onUpdated?.(stories));
    return off;
  }, [controller, props]);

  useEffect(() => {
    const off = controller.onSequenceEnd(() => {
      props.onClose();
    });
    return off;
  }, [controller, props]);

  useEffect(() => {
    controller.resume("visibility");
    return () => controller.pause("visibility");
  }, [controller]);

  useEffect(() => {
    controller.setPaused(menuOpen, "menu");
  }, [controller, menuOpen]);

  useEffect(() => {
    const currentId = state.currentStory?.id ?? null;
    if (currentId !== lastStoryIdRef.current) {
      lastStoryIdRef.current = currentId;
      setMenuOpen(false);
    }
  }, [state.currentStory?.id]);

  useEffect(() => {
    return () => controller.destroy();
  }, [controller]);

  const isOwnStory = state.isOwnStory;
  const deleting = state.isDeleting;
  const index = Math.min(state.index, Math.max(0, state.total - 1));
  const total = state.total;
  const progress = state.progress;
  const storiesForProgress = state.stories ?? props.stories;
  const currentStory = state.currentStory;
  const currentItem = state.currentItem as any;

  const formattedCreatedAt = useMemo(() => {
    if (!currentStory) return "";
    try {
      return new Date(currentStory.created_at).toLocaleString();
    } catch {
      return (currentStory as any).created_at || "";
    }
  }, [currentStory]);

  const media = useMemo(() => {
    if (!currentItem) return null;
    if (currentItem.type === "image") {
      return <img src={currentItem.url} className="w-full h-full object-contain" />;
    }
    if (currentItem.type === "video") {
      return <video src={currentItem.url} className="w-full h-full" autoPlay muted controls />;
    }
    if (currentItem.type === "text") {
      return (
        <div
          className="w-full h-full flex items-center justify-center px-8"
          style={{
            color: currentItem.color || "#fff",
            backgroundColor: currentItem.backgroundColor || "#000",
            fontFamily: currentItem.fontFamily || "inherit",
            fontWeight: currentItem.fontWeight ? String(currentItem.fontWeight) : "600",
          }}
        >
          <p
            className="text-2xl leading-snug whitespace-pre-wrap break-words w-full"
            style={{
              color: currentItem.color || "#fff",
              textAlign: currentItem.align || "center",
            }}
          >
            {currentItem.text}
          </p>
        </div>
      );
    }
    if (currentItem.type === "extension") {
      if (isCanvasExtensionSlide(currentItem)) {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <StoryCanvas data={currentItem.payload.canvas} className="w-full h-full" />
          </div>
        );
      }
      return (
        <div className="w-full h-full flex items-center justify-center text-white/70 text-sm px-8 text-center">
          拡張スライド ({currentItem.extensionType}) は未対応です。
        </div>
      );
    }
    return null;
  }, [currentItem]);

  const authorName = useMemo(() => props.author?.display_name || "ストーリー", [props.author?.display_name]);
  const authorAvatar = useMemo(() => props.author?.avatar_url || "", [props.author?.avatar_url]);

  const handleDelete = async () => {
    if (!currentStory || !isOwnStory || deleting) return;
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
    if (!currentStory || !isOwnStory || extending) return;
    setExtending(true);
    try {
      await updateStory(currentStory.id, { extendHours: 24 });
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

  const totalDisplay = useMemo(() => {
    const value = total;
    if (value > 0) return value;
    return props.stories.length;
  }, [props.stories.length, total]);

  const indexDisplay = useMemo(() => {
    const totalValue = totalDisplay;
    if (totalValue <= 0) return 0;
    return Math.min(index + 1, totalValue);
  }, [index, totalDisplay]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          controller.pause("visibility");
          props.onClose();
        }
      }}
    >
      <div
        className="relative w-full max-w-[420px] aspect-[1080/1920] rounded-[32px] bg-black overflow-hidden shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen(false);
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-full flex items-center justify-center">{media}</div>
        </div>

        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

        <div className="absolute top-4 left-4 right-4 space-y-3">
          <div className="flex gap-1">
            {storiesForProgress.map((_, i) => (
              <div key={i} className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-white"
                  style={{
                    width:
                      i < index
                        ? "100%"
                        : i > index
                          ? "0%"
                          : `${Math.min(100, Math.floor(progress * 100))}%`,
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-3">
              <Avatar src={authorAvatar} alt="作者" className="w-10 h-10 rounded-full shrink-0 border border-white/30" />
              <div className="flex flex-col text-sm leading-tight">
                <span className="font-semibold">{authorName}</span>
                <span className="text-white/70 text-xs">{formattedCreatedAt}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/60">
                {indexDisplay} / {totalDisplay}
              </span>
              {isOwnStory && (
                <div className="relative">
                  <button
                    className={MENU_BUTTON}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen((open) => !open);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen ? "true" : "false"}
                    aria-label="その他の操作"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="5" r="1" />
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="19" r="1" />
                    </svg>
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 mt-2 w-40 rounded-2xl bg-black/85 backdrop-blur border border-white/10 shadow-lg py-2">
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 flex items-center gap-2 disabled:opacity-60"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleExtend();
                        }}
                        disabled={extending}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 8v4l3 3" />
                          <circle cx="12" cy="12" r="9" />
                        </svg>
                        <span>{extending ? "延長中…" : "24時間延長"}</span>
                      </button>
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/10 flex items-center gap-2"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete();
                        }}
                        disabled={deleting}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m3 6 3 16h12l3-16" />
                          <path d="M2 6h20" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M8 6V4h8v2" />
                        </svg>
                        <span>{deleting ? "削除中..." : "削除"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                onClick={() => {
                  controller.pause("visibility");
                  props.onClose();
                }}
                aria-label="閉じる"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <button className="absolute top-16 bottom-32 left-0 w-1/4" onClick={prev} aria-label="前のストーリー" />
        <button className="absolute top-16 bottom-32 right-0 w-1/4" onClick={next} aria-label="次のストーリー" />

        <div className="absolute inset-x-4 bottom-6">
          <div className="flex items-center gap-3 text-white/90 text-sm rounded-2xl bg-white/10 backdrop-blur px-4 py-3">
            <div className="flex-1">現在ストーリーへの返信・リアクションは未対応です。近日アップデート予定です。</div>
            <button
              className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
              onClick={() => props.onClose()}
              aria-label="閉じる"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
