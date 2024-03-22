export default function User({ userName, latestMessage }) {
  return (
    <>
      <li class="c-talk-rooms">
        <a href="">
          <div class="c-talk-rooms-icon">
            <img src="static/logo.png" alt="" />
          </div>
          <div class="c-talk-rooms-box">
            <div class="c-talk-rooms-name">
              <p>{userName}</p>
            </div>
            <div class="c-talk-rooms-msg">
              <p>{latestMessage}</p>
            </div>
          </div>
        </a>
      </li>
    </>
  );
}
