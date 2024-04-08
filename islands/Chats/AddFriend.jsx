export default function User({ userName, latestMessage }) {
  return (
    <>
      <li class="c-talk-rooms is-active">
        <button>
          <span class="c-talk-rooms-icon">
            <img src="static/logo.png" alt="" />
          </span>
          <span class="c-talk-rooms-box">
            <span class="c-talk-rooms-name">
              <span>{userName}</span>
            </span>
            <span class="c-talk-rooms-msg">
              <span>{latestMessage}</span>
            </span>
          </span>
        </button>
      </li>
    </>
  )
}
