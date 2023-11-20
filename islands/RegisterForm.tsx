// routes/_app.tsx
import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import Button from '../components/Button.tsx'
export default function privacy() {
return (<div>
    <form action="" method="post" name="register">
        <div class="form-group">
            <label for="name" class="text-white">ユーザー名</label>
            <input type="text" name="name" id="name" class="form-control" placeholder="ユーザー名" required />
        </div>
        <div class="form-group">
            <label for="email" class="text-white">メールアドレス</label>
            <input type="email" name="email" id="email" class="form-control" placeholder="メールアドレス" required />
        </div>
        <button 
        class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        onClick={async function() {
            const name = document.getElementById("name").value;
            const email = document.getElementById("email").value;
            let errors = [];
            let iserror = false;
            if (!name || !email || !password || !password_confirmation) {
                //alert("すべての値を入力してください");
                //return;
                errors.push("すべての値を入力してください");
                iserror = true;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                errors.push("メールアドレスの形式が正しくありません");
                iserror = true;
            }
            if(iserror) {
                alert(errors.join("\n"));
                return;
            }
            const data = { name: name, email: email, password: password};
            try {
                const response = await fetch("https://localhost:8000/api/login", {
                    method: "POST", // or 'PUT'
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(data),
                });
                const result = await response.json();
                switch(result){
                    case result.status === "success":
                        const token = result.uuid;
                        alert("仮登録が完了しました。メールを確認してください。");
                        return;
                        break;
                    case result.status === "error" && result.message === "duplication username":
                        alert("そのユーザー名は既に使われています。");
                        return;
                        break;
                    case result.status === "error" && result.message === "duplication email":
                        alert("そのメールアドレスは既に使われています。");
                        return;
                        break;
                    default:
                        alert("エラーが発生しました。");
                        break;
                }
            } catch (error) {
                alert("エラーが発生しました。" + error);
            }
        }}
        >登録</button>
    </form>
</div>)
}