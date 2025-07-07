import { onCleanup, onMount } from "solid-js";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";

type Props = {
  src: string;
  onCropped?: (dataUrl: string) => void;
  aspectRatio: number;
  ref?: { handleCrop: () => void };
};

export default function SolidCropper(props: Props) {
  let imageRef: HTMLImageElement;
  let cropper: Cropper;

  onMount(() => {
    //@ts-ignore
    cropper = new Cropper(imageRef, {
      aspectRatio: props.aspectRatio,
      viewMode: 1,
      responsive: true,
      restore: true,
      autoCropArea: 0.8,
      checkOrientation: false, // より速く表示するためにOrientationチェックをスキップ
    });
  });

  onCleanup(() => {
    cropper?.destroy();
  });

  const handleCrop = () => {
    if (cropper && props.onCropped) {
      props.onCropped(cropper.getCroppedCanvas().toDataURL());
    }
  };

  // refを通じてhandleCrop関数を外部に公開
  if (props.ref) {
    props.ref.handleCrop = handleCrop;
  }

  return (
    <div class="cropper-container" style={{ "max-height": "100%" }}>
      {/*@ts-ignore */}
      <img ref={imageRef} src={props.src} style={{ "max-width": "100%" }} />
    </div>
  );
}
