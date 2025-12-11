import { useMemo, useRef, useState } from "react";
import type React from "react";
import Avatar from "./Avatar";
import { api, uploadMedia, useMe } from "../lib/api";
import { useAsyncResource } from "../lib/useAsyncResource";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

export default function PostComposer(props: Props) {
  const [selectedCommunity, setSelectedCommunity] = useState<string>("");
  const [audience, setAudience] = useState<"community" | "all">("all");
  const [text, setText] = useState("");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [communities] = useAsyncResource<any[]>(async () => api("/me/communities").catch(() => []));
  const me = useMe();

  const maxLength = 280;
  const remainingChars = maxLength - text.length;
  const isOverLimit = remainingChars < 0;
  const isNearLimit = remainingChars >= 0 && remainingChars < 20;
  const isDisabled = (!text.trim() && selectedImages.length === 0) || isOverLimit || posting;
  const charCountClass = isOverLimit
    ? "text-red-500"
    : isNearLimit
      ? "text-amber-500"
      : "text-gray-500 dark:text-gray-400";

  const user = useMemo(() => me(), [me]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const newPreviews: string[] = [];

    newFiles.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            newPreviews.push(event.target.result as string);
            if (newPreviews.length === newFiles.length) {
              setImagePreviews((prev) => [...prev, ...newPreviews]);
            }
          }
        };
        reader.readAsDataURL(file);
      }
    });

    setSelectedImages((prev) => [...prev, ...newFiles]);
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t && selectedImages.length === 0) return;

    setPosting(true);
    try {
      const mediaUrls: string[] = [];
      for (const file of selectedImages) {
        mediaUrls.push(await uploadMedia(file));
      }

      const postData = {
        text: t,
        type: selectedImages.length > 0 ? "image" : "text",
        media_urls: mediaUrls,
        audience: selectedCommunity ? audience : "all",
      };

      if (selectedCommunity) {
        await api(`/communities/${selectedCommunity}/posts`, {
          method: "POST",
          body: JSON.stringify(postData),
        });
      } else {
        await api(`/posts`, {
          method: "POST",
          body: JSON.stringify(postData),
        });
      }

      setText("");
      setSelectedImages([]);
      setImagePreviews([]);
      setSelectedCommunity("");
      setAudience("all");
      props.onCreated?.();
      props.onClose();
    } finally {
      setPosting(false);
    }
  };

  const formRef = useRef<HTMLFormElement | null>(null);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center sm:items-start sm:pt-12 px-0 sm:px-4"
      onClick={props.onClose}
    >
      <div
        className="bg-white dark:bg-[#111] w-screen h-screen sm:w-full sm:max-w-2xl rounded-none sm:rounded-[20px] shadow-xl border border-gray-200/80 dark:border-white/10 overflow-hidden sm:h-auto sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/80 dark:border-white/10">
          <button
            type="button"
            aria-label="閉じる"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-black/15 dark:hover:bg-white/20"
            onClick={props.onClose}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">投稿を作成</div>
          <div>
            <button
              type="button"
              className="sm:hidden px-3 py-1.5 rounded-full text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "var(--text)",
                color: "var(--bg)",
              }}
              onClick={() => formRef.current?.requestSubmit?.() || formRef.current?.submit?.()}
              disabled={isDisabled}
            >
              {posting ? "投稿中…" : "投稿"}
            </button>
          </div>
        </div>

        <form ref={formRef} className="px-4 sm:px-6 py-4 sm:py-6 overflow-auto flex-1" onSubmit={submit}>
          <div className="flex flex-col gap-5">
            {user ? (
              <div className="flex items-start gap-3">
                <Avatar
                  src={user.avatar_url ?? undefined}
                  alt="ユーザーアイコン"
                  className="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {user.display_name ?? (user as any).handle ?? ""}
                  </div>
                  <div className="text-xs text-muted mt-1">コミュニティを選択してください</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" />
                <div className="flex-1 h-12 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />
              </div>
            )}

            <textarea
              className="w-full min-h-[140px] resize-none border-none outline-none bg-transparent text-[18px] leading-6 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              placeholder="何を投稿しますか？"
              value={text}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
              maxLength={maxLength}
            />

            {imagePreviews.length > 0 && (
              <div className="grid gap-3 grid-cols-2">
                {imagePreviews.map((preview, index) => (
                  <div key={preview + index} className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <img src={preview} alt={`プレビュー${index + 1}`} className="w-full h-32 object-cover" />
                    <button
                      type="button"
                      className="absolute top-2 right-2 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-black/70"
                      onClick={() => removeImage(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <label className="w-10 h-10 rounded-full bg-black/10 dark:bg-white/10 text-gray-900 dark:text-white flex items-center justify-center cursor-pointer transition-colors hover:bg-black/15 dark:hover:bg-white/20">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageSelect} />
                </label>

                <div className="relative">
                  <select
                    className="appearance-none pl-4 pr-10 py-2 text-sm font-semibold rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                    value={selectedCommunity}
                    onChange={(e) => setSelectedCommunity((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">コミュニティを選択</option>
                    {(communities.data as any[])?.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 9-7 7-7-7" />
                  </svg>
                </div>

                <div className="flex items-center rounded-full border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                  <button
                    type="button"
                    className={`px-3 py-2 font-medium transition-colors ${audience === "all" ? "bg-gray-900 text-white dark:bg-white dark:text-black" : "bg-transparent text-gray-600 dark:text-gray-300"}`}
                    onClick={() => setAudience("all")}
                  >
                    公開
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 font-medium transition-colors ${audience === "community" ? "bg-gray-900 text-white dark:bg-white dark:text-black" : "bg-transparent text-gray-600 dark:text-gray-300"}`}
                    onClick={() => setAudience("community")}
                  >
                    非公開
                  </button>
                </div>
              </div>

              <span className={`text-sm ${charCountClass}`}>{remainingChars}</span>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="hidden sm:inline-flex px-6 py-2 rounded-full font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "var(--text)",
                  color: "var(--bg)",
                }}
                disabled={isDisabled}
              >
                {posting ? "投稿中…" : "投稿"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
