import { Component, Show, For } from "solid-js";
import { useAtom } from "solid-jotai";
import { loggedInState } from "../state.ts";

// ------------------------------
// Enhanced Icons with better accessibility
// ------------------------------
const Check = () => (
  <svg class="w-5 h-5 inline-block text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5"/>
  </svg>
);

const Cross = () => (
  <svg class="w-5 h-5 inline-block text-rose-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const Download = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </svg>
);

const ArrowRight = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

const Shield = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const Zap = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"/>
  </svg>
);

const Puzzle = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19.439 7.85c-.049.322-.059.648-.026.975.039.412.128.819.268 1.205.087.24.187.479.313.705.066.132.145.259.234.381.068.073.146.143.231.204.1.069.202.138.327.191.204.08.4.121.611.121.303 0 .611-.063.894-.207.284-.144.544-.334.753-.566.209-.232.369-.507.468-.805.1-.298.129-.616.098-.928-.031-.312-.129-.616-.272-.895-.143-.279-.334-.53-.566-.739-.232-.209-.507-.369-.805-.468-.298-.1-.616-.129-.928-.098-.312.031-.616.129-.895.272-.279.143-.53.334-.739.566-.209.232-.369.507-.468.805z"/>
  </svg>
);

const Globe = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
  </svg>
);

const Lock = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <circle cx="12" cy="16" r="1"/>
    <path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);

const Smartphone = () => (
  <svg class="w-8 h-8 text-indigo-400 mb-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
    <line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
);

// ------------------------------
// Enhanced Data with icons
// ------------------------------
const FEATURES = [
  {
    icon: Shield,
    title: "完全オープンソース",
    desc: "MIT ライセンスで透明性と自由度を確保。あなたのサーバーをあなたのルールで運営できます。",
    highlight: "透明性"
  },
  {
    icon: Zap,
    title: "瞬時にスケール",
    desc: "軽量 Rust + Deno 実装により数百〜数万ユーザーまで滑らかに拡張。パフォーマンスを犠牲にしません。",
    highlight: "高速"
  },
  {
    icon: Puzzle,
    title: "プラグインで拡張",
    desc: "検索、AI アシスタント、ストリーミング等のプラグインを数クリックで追加。機能を自由にカスタマイズ。",
    highlight: "拡張性"
  },
  {
    icon: Globe,
    title: "ゼロ・ロックイン",
    desc: "ActivityPub 準拠で他 Fediverse ノードと自由に連携。いつでもデータをエクスポート可能。",
    highlight: "自由度"
  },
  {
    icon: Lock,
    title: "mKEM + HPKE 暗号化",
    desc: "ポスト量子時代に備えた End-to-End 暗号化を標準搭載。プライバシーを最優先に設計。",
    highlight: "セキュア"
  },
  {
    icon: Smartphone,
    title: "マルチプラットフォーム",
    desc: "デスクトップ／Tauri クライアント + iOS/Android アプリを同梱。どこでも快適に利用可能。",
    highlight: "便利"
  },
];

const COMPARISON = [
  { label: "OSS & 自己ホスト", takos: true, others: false },
  { label: "プラグイン経済圏", takos: true, others: false },
  { label: "E2EE (mKEM)", takos: true, others: false },
  { label: "1クリックスケール", takos: true, others: false },
  { label: "料金 (月額)", takos: "¥0〜", others: "¥1,000+" },
  { label: "データ所有権", takos: true, others: false },
  { label: "カスタマイズ性", takos: true, others: false },
];

// ------------------------------
// Enhanced Component with better UX
// ------------------------------
const LandingPage: Component = () => {
  const [loggedIn] = useAtom(loggedInState);

  return (
    <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-slate-100 font-sans antialiased">
      {/* Enhanced Sticky Nav with better backdrop */}
      <header class="fixed top-0 inset-x-0 z-50 backdrop-blur-xl supports-[backdrop-filter]:bg-slate-900/90 border-b border-slate-800/50 shadow-lg">
        <div class="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <a href="/" class="flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
            <div class="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              T
            </div>
            takos
          </a>
          <nav class="hidden md:flex gap-8 text-sm font-medium">
            <a href="#features" class="hover:text-indigo-400 transition-colors py-2">機能</a>
            <a href="#compare" class="hover:text-indigo-400 transition-colors py-2">比較</a>
            <a href="https://github.com/takoserver/takos" target="_blank" rel="noopener noreferrer" class="hover:text-indigo-400 transition-colors py-2">GitHub</a>
          </nav>
          <Show
            when={loggedIn()}
            fallback={
              <a href="/auth" class="rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-semibold shadow-lg hover:shadow-xl hover:from-indigo-500 hover:to-indigo-400 transition-all duration-200 transform hover:scale-105">
                ログイン
              </a>
            }
          >
            <a href="/user" class="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2.5 text-sm font-semibold shadow-lg hover:shadow-xl hover:from-emerald-500 hover:to-emerald-400 transition-all duration-200 transform hover:scale-105">
              ダッシュボード
            </a>
          </Show>
        </div>
      </header>

      {/* Enhanced Hero with better visual hierarchy */}
      <section class="pt-36 pb-32 text-center px-6 relative overflow-hidden" id="hero">
        {/* Subtle background pattern */}
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.1),transparent_70%)]"></div>
        
        <div class="relative z-10">
          <div class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-950/50 border border-indigo-500/20 rounded-full text-sm text-indigo-300 mb-8">
            <div class="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></div>
            Open Source ActivityPub Server
          </div>
          
          <h1 class="text-5xl sm:text-6xl md:text-7xl font-extrabold leading-tight mb-6">
            一人一台の
            <br class="sm:hidden" />
            <span class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              ActivityPub
            </span>
            <br />
            サーバー
          </h1>
          
          <p class="mt-8 max-w-3xl mx-auto text-xl sm:text-2xl text-slate-300 leading-relaxed">
            <span class="font-semibold text-indigo-300">takos host</span> は、分散型 SNS を
            <span class="font-semibold text-emerald-300">ゼロ知識</span>でも
            <br class="hidden sm:inline" />
            数分で立ち上げられるオープンソース・プラットフォームです。
          </p>
          
          <div class="mt-12 flex flex-col sm:flex-row justify-center gap-4 max-w-md mx-auto">
            <a href="/download" class="group inline-flex items-center justify-center gap-3 rounded-2xl px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold shadow-xl hover:shadow-2xl hover:from-indigo-500 hover:to-purple-500 transition-all duration-300 transform hover:scale-105">
              <Download />
              アプリをダウンロード
            </a>
            <a href="/signup" class="group inline-flex items-center justify-center gap-3 rounded-2xl px-8 py-4 border-2 border-slate-500 text-slate-200 font-semibold hover:bg-slate-800 hover:border-slate-400 transition-all duration-300 transform hover:scale-105">
              無料で始める
              <ArrowRight />
            </a>
          </div>
        </div>
      </section>

      {/* Enhanced Features with better cards */}
      <section id="features" class="py-24 bg-slate-950/60 backdrop-blur-md relative">
        <div class="max-w-7xl mx-auto px-6">
          <div class="text-center mb-16">
            <h2 class="text-4xl sm:text-5xl font-bold mb-6">
              なぜ <span class="text-indigo-400">takos</span> なのか？
            </h2>
            <p class="text-xl text-slate-300 max-w-3xl mx-auto">
              従来のSNSプラットフォームの制約から解放され、真に自由なコミュニケーションを実現
            </p>
          </div>
          
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <For each={FEATURES}>{(f) => {
              const IconComponent = f.icon;
              return (
                <div class="group relative rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 p-8 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 border border-slate-700/50 hover:border-indigo-500/50">
                  <div class="absolute inset-0 bg-gradient-to-br from-indigo-600/10 to-purple-600/10 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  
                  <div class="relative z-10">
                    <IconComponent />
                    <div class="inline-flex items-center gap-2 mb-4">
                      <h3 class="text-xl font-bold text-white">{f.title}</h3>
                      <span class="px-2 py-1 bg-indigo-500/20 text-indigo-300 text-xs rounded-full">{f.highlight}</span>
                    </div>
                    <p class="text-slate-300 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              );
            }}</For>
          </div>
        </div>
      </section>

      {/* Enhanced Comparison with better table design */}
      <section id="compare" class="py-24 px-6">
        <div class="max-w-6xl mx-auto">
          <div class="text-center mb-16">
            <h2 class="text-4xl sm:text-5xl font-bold mb-6">他社サービスとの比較</h2>
            <p class="text-xl text-slate-300">なぜ takos が最適な選択なのかを数字で比較</p>
          </div>
          
          <div class="bg-slate-900/50 rounded-3xl p-8 shadow-2xl border border-slate-700/50 overflow-x-auto">
            <table class="w-full text-sm md:text-base">
              <thead>
                <tr class="border-b-2 border-slate-700">
                  <th class="py-6 text-left font-bold text-lg">項目</th>
                  <th class="py-6 font-bold text-lg">
                    <div class="flex items-center justify-center gap-2">
                      <div class="w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">T</div>
                      takos
                    </div>
                  </th>
                  <th class="py-6 font-bold text-lg text-slate-400">他社レンタル</th>
                </tr>
              </thead>
              <tbody>
                <For each={COMPARISON}>{(row, index) => (
                  <tr class={`border-b border-slate-800 last:border-none hover:bg-slate-800/30 transition-colors ${index() % 2 === 0 ? 'bg-slate-800/20' : ''}`}>
                    <td class="py-6 pr-6 font-medium">{row.label}</td>
                    <td class="py-6 text-center">
                      <div class="flex justify-center">
                        {typeof row.takos === "boolean" ? (
                          row.takos ? (
                            <div class="flex items-center gap-2 text-emerald-400 font-semibold">
                              <Check /> 対応
                            </div>
                          ) : (
                            <div class="flex items-center gap-2 text-rose-400 font-semibold">
                              <Cross /> 非対応
                            </div>
                          )
                        ) : (
                          <span class="font-bold text-emerald-400 text-lg">{row.takos}</span>
                        )}
                      </div>
                    </td>
                    <td class="py-6 text-center text-slate-400">
                      <div class="flex justify-center">
                        {typeof row.others === "boolean" ? (
                          row.others ? (
                            <div class="flex items-center gap-2 text-emerald-400 font-semibold">
                              <Check /> 対応
                            </div>
                          ) : (
                            <div class="flex items-center gap-2 text-rose-400 font-semibold">
                              <Cross /> 非対応
                            </div>
                          )
                        ) : (
                          <span class="font-bold text-rose-400 text-lg">{row.others}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enhanced CTA with better visual impact */}
      <section class="py-32 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 text-center relative overflow-hidden">
        <div class="absolute inset-0 bg-black/20"></div>
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.1),transparent_70%)]"></div>
        
        <div class="relative z-10 max-w-4xl mx-auto px-6">
          <h2 class="text-4xl sm:text-5xl md:text-6xl font-extrabold mb-8 leading-tight">
            今すぐ、あなた専用の
            <br />
            サーバーを始めよう
          </h2>
          <p class="text-xl sm:text-2xl text-indigo-100 mb-12 max-w-2xl mx-auto">
            数分で設定完了。月額料金なし。完全にあなたのものです。
          </p>
          
          <div class="flex flex-col sm:flex-row gap-4 justify-center max-w-md mx-auto">
            <a href="/signup" class="group inline-flex items-center justify-center gap-3 rounded-2xl px-8 py-4 bg-white text-slate-900 font-bold shadow-2xl hover:shadow-3xl transition-all duration-300 transform hover:scale-105">
              無料で始める
              <ArrowRight />
            </a>
            <a href="/demo" class="group inline-flex items-center justify-center gap-3 rounded-2xl px-8 py-4 border-2 border-white/50 text-white font-semibold hover:bg-white/10 transition-all duration-300 transform hover:scale-105">
              デモを見る
            </a>
          </div>
        </div>
      </section>

      {/* Enhanced Footer */}
      <footer class="py-12 bg-slate-950/90 backdrop-blur-md border-t border-slate-800/50">
        <div class="max-w-7xl mx-auto px-6">
          <div class="text-center">
            <div class="flex items-center justify-center gap-2 mb-4">
              <div class="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                T
              </div>
              <span class="text-xl font-bold">takos</span>
            </div>
            <p class="text-slate-400 text-sm">
              © {new Date().getFullYear()} takoserver. MIT Licensed. 
              <span class="text-indigo-400">Made with ❤️ for the Fediverse</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;