/* @refresh reload */
import { render } from "solid-js/web";

import App from "./App.tsx";
import "./style.css";

render(() => <App />, document.getElementById("app")!);
