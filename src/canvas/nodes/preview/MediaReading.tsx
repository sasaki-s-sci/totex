import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./mediaReading.css";

export function MediaReading({
  source,
  name,
  kind,
}: {
  source: string;
  name: string;
  kind: "video" | "audio";
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const player = kind === "video" ? video.current : audio.current;
    if (!player) return;
    setFailed(false);
    const fail = () => setFailed(true);
    player.addEventListener("error", fail);
    player.src = source;
    return () => {
      player.removeEventListener("error", fail);
      player.pause();
      player.removeAttribute("src");
      // Reset the decoder and release playback resources when the preview closes.
      player.load();
    };
  }, [source, kind]);

  return (
    <div className={`file-preview__media file-preview__media--${kind} nodrag nopan nowheel`}>
      {kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: Local files do not provide a separate caption track.
        <video ref={video} controls playsInline preload="metadata" aria-label={name} />
      ) : (
        <>
          <span className="file-preview__media-name">{name}</span>
          {/* biome-ignore lint/a11y/useMediaCaption: Local files do not provide a separate caption track. */}
          <audio ref={audio} controls preload="metadata" aria-label={name} />
        </>
      )}
      {failed && (
        <p className="file-preview__media-error" role="alert">
          {t("filePreview.mediaFailed", {
            defaultValue:
              "This media could not be played. Its codec may not be supported on this device, or the file may be damaged.",
          })}
        </p>
      )}
    </div>
  );
}
