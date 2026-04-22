import { Show } from "solid-js";
import type { CommunityDetail } from "../../lib/api.ts";

interface CommunityAboutPanelProps {
  community: CommunityDetail;
}

export function CommunityAboutPanel(props: CommunityAboutPanelProps) {
  return (
    <div class="p-4">
      <Show
        when={props.community.summary}
        fallback={
          <div class="text-neutral-500 text-center py-8">
            説明がありません
          </div>
        }
      >
        <div>
          <h3 class="text-lg font-bold mb-2">グループについて</h3>
          <p class="text-neutral-300 whitespace-pre-wrap">
            {props.community.summary}
          </p>
        </div>
      </Show>
    </div>
  );
}
