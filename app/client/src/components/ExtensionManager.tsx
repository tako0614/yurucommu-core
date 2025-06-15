import ExtensionUpload from "./ExtensionUpload.tsx";
import ExtensionRegistry from "./ExtensionRegistry.tsx";

export default function ExtensionManager() {
  return (
    <div>
      <h3 class="text-lg mb-2">拡張機能</h3>
      <ExtensionUpload hideHeader />
      <hr class="my-4 border-gray-700" />
      <ExtensionRegistry hideHeader />
    </div>
  );
}
