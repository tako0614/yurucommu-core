import { Story } from "../../types/sns";

type StoryItemProps = {
  story: Story;
};

export default function StoryItem(props: StoryItemProps) {
  const { story } = props;

  return (
    <div class="flex flex-col items-center mr-4 min-w-[70px]">
      <div
        class={`w-16 h-16 rounded-full p-0.5 mb-1 ${
          story.viewed
            ? "bg-gray-200"
            : "bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600"
        }`}
      >
        <img
          src={story.author.avatar || "https://placehold.jp/50x50.png"}
          alt={story.author.displayName}
          class="w-full h-full rounded-full border-2 border-white"
        />
      </div>
      <span class="text-xs text-center truncate w-full">
        {story.author.displayName}
      </span>
    </div>
  );
}
