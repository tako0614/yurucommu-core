// routes/_app.tsx
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
export default function privacy() {
    return (
      <html>
        <head>
          <title>takoserver</title>
          <link rel="stylesheet" href="/style.css"></link>
        </head>
        <body>
          <Header />
          <div class="p-16 w-3/4 m-auto">
          </div>
          <Footer />
        </body>
      </html>
    );
}
/*async function postJSON(data) {
  try {
    const response = await fetch("http://localhost:8000/api/login", {
      method: "POST", // or 'PUT'
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    console.log("Success:", result);
  } catch (error) {
    console.error("Error:", error);
  }
}

const data = { username: "example" };
postJSON(data); */