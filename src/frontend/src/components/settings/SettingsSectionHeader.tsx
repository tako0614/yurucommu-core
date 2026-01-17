import { BackIcon } from './SettingsIcons';

interface SettingsSectionHeaderProps {
  title: string;
  onBack: () => void;
  accent?: 'danger';
}

export function SettingsSectionHeader({ title, onBack, accent }: SettingsSectionHeaderProps) {
  const titleClass = accent === 'danger' ? 'text-red-500' : '';

  return (
    <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
      <div className="flex items-center gap-4 px-4 py-3">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
          <BackIcon />
        </button>
        <h1 className={`text-xl font-bold ${titleClass}`}>{title}</h1>
      </div>
    </header>
  );
}
