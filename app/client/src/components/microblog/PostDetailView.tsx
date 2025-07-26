import { For } from "solid-js";
import type { MicroblogPost } from "./types.ts";
import { PostItem } from "./Post.tsx";

type PostDetailViewProps = {
  post: MicroblogPost;
  replies: MicroblogPost[];
  onBack: () => void;
  onReplySubmit: (
    content: string,
    attachments: { url: string; type: "image" | "video" | "audio" }[],
  ) => Promise<void>;
  handleLike: (id: string) => void;
  handleRetweet: (id: string) => void;
  handleQuote: (id: string) => void;
  handleEdit: (id: string, current: string) => void;
  handleDelete: (id: string) => void;
  formatDate: (dateString: string) => string;
};

export function PostDetailView(props: PostDetailViewProps) {
  return (
    <div class="text-white">
      <div class="p-4 border-b border-gray-800">
        <button
          type="button"
          onClick={props.onBack}
          class="text-blue-400 hover:underline mb-4"
        >
          ← 戻る
        </button>
        <PostItem
          post={props.post}
          tab="latest"
          handleReply={() => {}}
          handleLike={props.handleLike}
          handleRetweet={props.handleRetweet}
          handleQuote={props.handleQuote}
          handleEdit={props.handleEdit}
          handleDelete={props.handleDelete}
          formatDate={props.formatDate}
        />
      </div>
      <div class="divide-y divide-gray-800">
        <For each={props.replies}>
          {(reply) => (
            <PostItem
              post={reply}
              tab="latest"
              isReply
              handleReply={() => {}}
              handleLike={props.handleLike}
              handleRetweet={props.handleRetweet}
              handleQuote={props.handleQuote}
              handleEdit={props.handleEdit}
              handleDelete={props.handleDelete}
              formatDate={props.formatDate}
            />
          )}
        </For>
      </div>
    </div>
  );
}
