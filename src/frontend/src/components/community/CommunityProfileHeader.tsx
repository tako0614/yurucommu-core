import { BackIcon } from './CommunityIcons';

interface CommunityProfileHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
}

export function CommunityProfileHeader({ title, subtitle, onBack }: CommunityProfileHeaderProps) {
  return (
    <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
      <div className="flex items-center gap-4 px-4 py-3">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
          <BackIcon />
        </button>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-neutral-500">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}
