import { Component, createSignal, onMount } from "solid-js";
import MarkdownIt from "markdown-it";

const TermsPage: Component = () => {
  const [html, setHtml] = createSignal("");
  const md = new MarkdownIt({ breaks: true, linkify: true });

  onMount(async () => {
    const res = await fetch("/terms");
    if (res.ok) {
      const txt = await res.text();
      setHtml(md.render(txt));
    }
  });

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100 px-4 py-8">
      <main class="flex-grow max-w-2xl mx-auto w-full">
        <h1 class="text-2xl font-semibold mb-4">利用規約</h1>
        <div
          class="mt-4 text-sm"
          innerHTML={html() || "<p>利用規約が設定されていません</p>"}
        />
      </main>
      <footer class="py-6 border-t border-gray-700 text-center mt-8">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default TermsPage;
