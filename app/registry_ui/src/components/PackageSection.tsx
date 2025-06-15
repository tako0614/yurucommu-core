import { createSignal, For } from "solid-js";
import { req } from "../api.ts";

interface Pack {
  identifier: string;
  version: string;
}

export default function PackageSection() {
  const [packages, setPackages] = createSignal<Pack[]>([]);
  let idInput!: HTMLInputElement;
  let nameInput!: HTMLInputElement;
  let versionInput!: HTMLInputElement;
  let descInput!: HTMLInputElement;
  let urlInput!: HTMLInputElement;
  let shaInput!: HTMLInputElement;

  const refresh = async () => {
    const data = await req<{ packages: Pack[] }>("/_takopack/search");
    setPackages(data.packages);
  };

  const add = async () => {
    await req("/api/packages", "POST", {
      identifier: idInput.value,
      name: nameInput.value,
      version: versionInput.value,
      description: descInput.value,
      downloadUrl: urlInput.value,
      sha256: shaInput.value || undefined,
    });
    refresh();
  };

  return (
    <div class="bg-white shadow rounded p-4">
      <h2 class="text-xl font-semibold mb-4">Packages</h2>
      <ul class="mb-4 space-y-1">
        <For each={packages()}>
          {(p) => (
            <li class="flex justify-between">
              <span>{p.identifier}</span>
              <span class="text-gray-500">{p.version}</span>
            </li>
          )}
        </For>
      </ul>
      <button
        type="button"
        class="px-3 py-1 bg-gray-500 text-white rounded mb-4"
        onClick={refresh}
      >
        Refresh
      </button>
      <h3 class="text-lg font-semibold mb-2">Add</h3>
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input
          class="border border-gray-300 p-1 rounded"
          ref={idInput!}
          placeholder="com.example.foo"
        />
        <input
          class="border border-gray-300 p-1 rounded"
          ref={nameInput!}
          placeholder="name"
        />
        <input
          class="border border-gray-300 p-1 rounded"
          ref={versionInput!}
          placeholder="1.0.0"
        />
        <input
          class="border border-gray-300 p-1 rounded"
          ref={descInput!}
          placeholder="description"
        />
        <input
          class="border border-gray-300 p-1 rounded col-span-2"
          ref={urlInput!}
          placeholder="download url"
        />
        <input
          class="border border-gray-300 p-1 rounded col-span-2"
          ref={shaInput!}
          placeholder="sha256(optional)"
        />
      </div>
      <button
        type="button"
        class="px-3 py-1 bg-blue-500 text-white rounded"
        onClick={add}
      >
        Add Package
      </button>
    </div>
  );
}
