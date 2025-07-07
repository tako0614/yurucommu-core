export function generateThumbnailFromFile(
  file: File,
  captureTime: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    // File から URL を生成
    video.src = URL.createObjectURL(file);
    // ファイルの場合、CORS 設定は不要です

    // 動画データの読み込みが完了したら、指定の時刻にシーク
    video.addEventListener("loadeddata", () => {
      video.currentTime = captureTime;
    }, { once: true });

    // シーク完了後に canvas に描画してサムネイルを作成
    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas のコンテキストを取得できません"));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnail = canvas.toDataURL("image/png");
      resolve(thumbnail);
      // 生成したオブジェクト URL は不要になったら解放する
      URL.revokeObjectURL(video.src);
    }, { once: true });

    video.addEventListener("error", (err) => {
      reject(err);
    }, { once: true });
  });
}
