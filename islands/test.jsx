import { h } from 'preact';
import { useState } from 'preact/hooks';


const App = () => {
  const [showModal, setShowModal] = useState(false);

  const handleButtonClick = () => {
    setShowModal(!showModal);
  }

  return (
    <div className="App">
      <button onClick={handleButtonClick}>
        ボタン
      </button>

      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <span className="close" onClick={handleButtonClick}>×</span>
            <p>ここにフォームを追加します</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

