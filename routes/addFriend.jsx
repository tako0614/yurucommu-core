import ChatAddFriend from "../components/Chats/ChatAddFriend.jsx";
export default function Home() {
  return (
    <>
      <head>
        <title>tako's | takos.jp</title>
        <meta
          name="description"
          content="日本産オープンソース分散型チャットアプリ「tako's」"
        />
        <link rel="stylesheet" href="/style.css"></link>
      </head>
      <ChatAddFriend></ChatAddFriend>
    </>
  );
}
