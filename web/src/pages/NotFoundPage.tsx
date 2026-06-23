import { A } from "@solidjs/router";
import { useI18n } from "../lib/i18n.tsx";

// Catch-all for unmatched in-app paths (typos, stale/shared deep links, old
// route shapes). Without a terminal route an unknown path renders nothing — a
// blank dead-end the user can only escape by editing the URL. This gives them an
// explicit not-found state with a way back home.
export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div class="flex flex-col items-center justify-center h-full p-8 text-center">
      <div class="text-5xl font-bold text-neutral-700 mb-4">404</div>
      <h1 class="text-xl font-bold text-white mb-2">{t("notFound.title")}</h1>
      <p class="text-neutral-400 mb-6 max-w-xs">{t("notFound.body")}</p>
      <A
        href="/"
        class="px-4 py-2 bg-accent text-white rounded-full font-medium transition-colors"
      >
        {t("notFound.home")}
      </A>
    </div>
  );
}

export default NotFoundPage;
