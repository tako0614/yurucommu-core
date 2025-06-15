import { createSignal } from "solid-js";
import { req } from "../api";

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
    <div class="mt-4">
      <h2 class="text-xl mb-2">Packages</h2>
      <ul class="mb-2">
        {packages().map((p) => <li>{p.identifier} {p.version}</li>)}
      </ul>
      <button class="px-2 py-1 bg-gray-500 text-white mb-2" onClick={refresh}>
        Refresh
      </button>
      <h3 class="text-lg mt-2">Add</h3>
      <input
        class="border p-1 mr-2"
        ref={idInput!}
        placeholder="com.example.foo"
      />
      <input class="border p-1 mr-2" ref={nameInput!} placeholder="name" />
      <input class="border p-1 mr-2" ref={versionInput!} placeholder="1.0.0" />
      <input
        class="border p-1 mr-2"
        ref={descInput!}
        placeholder="description"
      />
      <input
        class="border p-1 mr-2"
        ref={urlInput!}
        placeholder="download url"
      />
      <input
        class="border p-1 mr-2"
        ref={shaInput!}
        placeholder="sha256(optional)"
      />
      <button class="px-2 py-1 bg-blue-500 text-white" onClick={add}>
        Add Package
      </button>
    </div>
  );
}
