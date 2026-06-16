interface TimelineHeaderProps {
  title: string;
}

// Desktop title bar for the timeline. Mobile create/notification affordances now
// live in the app-shell header (AppHeaderMobile) and BottomNav, so they are no
// longer duplicated here.
export function TimelineHeader(props: TimelineHeaderProps) {
  return (
    <header class="hidden md:block sticky top-0 bg-neutral-900/80 backdrop-blur-sm z-10">
      <div class="flex items-center px-4 py-4">
        <h1 class="text-xl font-bold">{props.title}</h1>
      </div>
    </header>
  );
}
