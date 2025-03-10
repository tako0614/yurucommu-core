import app from "../../_factory.ts";
import { load } from "@std/dotenv";

// 既存のファイル
import tempRegister from "./tempRegister.ts";
import checkRegister from "./checkRegister.ts";
import register from "./register.ts";
import setUp from "./setUp.ts";

// 新しく分割したファイル
import loginRoute from "./login.ts";
import logoutRoute from "./logout.ts";
import resetRoute from "./reset.ts";
import listRoute from "./list.ts";
import deleteRoute from "./delete.ts";
import statusRoute from "./status.ts";

// 暗号化関連のエンドポイント
import encryptRequest from "./encrypt/request.ts";
import encryptAccept from "./encrypt/accept.ts";
import encryptSend from "./encrypt/send.ts";
import encryptSuccess from "./encrypt/success.ts";

// 環境変数のロード
await load();

// 既存のルート
app.route("/register/temp", tempRegister);
app.route("/register/check", checkRegister);
app.route("/register", register);
app.route("/setUp", setUp);

// 新しく分割したルート
app.route("/login", loginRoute);
app.route("/logout", logoutRoute);
app.route("/reset", resetRoute);
app.route("/list", listRoute);
app.route("/delete", deleteRoute);
app.route("/status", statusRoute);

// 暗号化関連のルート
app.route("/encrypt/request", encryptRequest);
app.route("/encrypt/accept", encryptAccept);
app.route("/encrypt/send", encryptSend);
app.route("/encrypt/success", encryptSuccess);

export default app;
