/* @refresh reload */
import { render } from "solid-js/web";
import { registerSW } from "virtual:pwa-register";

import App from "./App.tsx";

render(() => <App />, document.getElementById("root")!);
// サービスワーカーを登録してPWAを有効化
registerSW({ immediate: true });
