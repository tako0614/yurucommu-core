// routes/_app.tsx
import { useSignal } from "@preact/signals";
import Header from '../components/Header.js'
import Footer from '../components/Footer.js'
import Button from '../components/Button.js'
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
        <div class="form-group">
            <label for="password" class="text-white">パスワード</label>
            <input type="password" name="password" id="password" class="form-control" placeholder="パスワード" required />
        </div>
        <div class="form-group">
            <label for="password_confirmation" class="text-white">パスワード(確認用)</label>
            <input type="password" name="password_confirmation" id="password_confirmation" class="form-control" placeholder="パスワード(確認用)" required />
        </div>
        <submit 
        onClick={async function() {
            const name = document.getElementById("name").value;
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;
            const password_confirmation = document.getElementById("password_confirmation").value;
            
            if (!name || !email || !password || !password_confirmation) {
                alert("すべての値を入力してください");
                return;
            }

            if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(password)) {
                alert("パスワードは8桁の英数字を含む必要があります");
                return;
            }
            
            if(password !== password_confirmation) {
                alert("パスワードが一致しません");
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
                if(result.status === "success") {
                    const token = result.uuid;
                    document.cookie = `token=${token}`;
                } else if(result.status === "error") {
                    alert("エラーが発生しました。");
                }else if(result.status ==="duplication"){
                    alert("そのユーザー名は既に使われています。");
                }
                switch(result){
                    case result.status === "success":
                        const token = result.uuid;
                        document.cookie = `token=${token}`;
                        break;
                    case result.status === "error" && result.message === "duplication username":
                        alert("そのユーザー名は既に使われています。");
                        break;
                    case result.status === "error" && result.message === "duplication email":
                        alert("そのメールアドレスは既に使われています。");
                        break;
                }
            } catch (error) {
                alert("エラーが発生しました。");
            }
        }}
        />
    </form>
</div>)
}