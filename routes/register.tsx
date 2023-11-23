// routes/_app.tsx
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import Form from '../islands/RegisterForm.tsx'
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
              <Form></Form>
            </div>
          <Footer />
        </body>
      </html>
    );
}