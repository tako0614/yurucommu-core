const ChatTitile = ({ title }) => {
  return (
    <>
      <div class="p-talk-chat-title">
        <div class="p-talk-chat-prev">
          <svg
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            aria-labelledby="chevronLeftIconTitle"
            stroke="#000000"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
            color="#000000"
          >
            <title id="chevronLeftIconTitle">Chevron Left</title>{" "}
            <polyline points="14 18 8 12 14 6 14 6" />
          </svg>
        </div>
        <p>{title}</p>
      </div>
    </>
  )
}
export default ChatTitile
