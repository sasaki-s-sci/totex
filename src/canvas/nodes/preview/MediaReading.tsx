import { Button, Popover, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type MediaPlayback, normalizeMediaPlayback } from "../../../lib/media";
import "./mediaReading.css";

export function MediaReading({
  source,
  name,
  kind,
  playback,
  onPlaybackChange,
  active = true,
  rangeAnchor,
  onCloseRange,
}: {
  source: string;
  name: string;
  kind: "video" | "audio";
  playback?: MediaPlayback;
  onPlaybackChange?: (next: MediaPlayback) => void;
  active?: boolean;
  rangeAnchor?: { left: number; top: number } | null;
  onCloseRange?: () => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const [seekFailed, setSeekFailed] = useState(false);
  const [fields, setFields] = useState({ position: "0", start: "0", end: "" });
  const { start, end, position, playing } = playback ?? {};
  const current = useRef({ playback, active });
  current.current = { playback, active };
  const previous = useRef<MediaPlayback>({});
  const apply = useRef<((next: MediaPlayback, seek?: boolean) => MediaPlayback | null) | null>(
    null,
  );

  useEffect(() => {
    const player = kind === "video" ? video.current : audio.current;
    if (!player) return;
    let mounted = true;
    let request = current.current.playback ?? {};
    let range = normalizeMediaPlayback({});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let playRequest = 0;
    let waiting = false;
    setFailed(false);
    setReady(false);
    setInvalid(false);
    setPlayFailed(false);
    setSeekFailed(false);
    const stopTimer = () => clearTimeout(timer);
    const seekTo = (position: number) => {
      if (player.currentTime === position) return true;
      for (let index = 0; index < player.seekable.length; index++) {
        if (position < player.seekable.start(index) || position > player.seekable.end(index))
          continue;
        player.currentTime = position;
        return true;
      }
      player.pause();
      if (player.readyState >= 3) setSeekFailed(true);
      return false;
    };
    const boundary = () => {
      stopTimer();
      if (player.seeking || waiting) return;
      if (player.currentTime < range.start && !seekTo(range.start)) return;
      if (range.end !== undefined && player.currentTime >= range.end) {
        player.pause();
        seekTo(range.end);
      } else if (!player.paused && range.end !== undefined && player.playbackRate > 0)
        timer = setTimeout(
          boundary,
          ((range.end - player.currentTime) / player.playbackRate) * 1000,
        );
    };
    const update = (next: MediaPlayback, seek = true) => {
      try {
        range = normalizeMediaPlayback(next, player.readyState >= 1 ? player.duration : Infinity);
      } catch {
        setInvalid(true);
        return null;
      }
      request = next;
      setInvalid(false);
      setPlayFailed(false);
      setSeekFailed(false);
      setFields({
        start: String(range.start),
        end: range.end === undefined ? "" : String(range.end),
        position: String(!seek && player.readyState >= 1 ? player.currentTime : range.position),
      });
      const version = ++playRequest;
      if (player.readyState >= 1) {
        if (seek && !seekTo(range.position)) {
          waiting = player.readyState < 3;
          return range;
        }
        waiting = false;
        if (range.playing === false) player.pause();
        else if (
          range.playing === true &&
          current.current.active &&
          (range.end === undefined || range.end > range.start)
        ) {
          if (range.end !== undefined && player.currentTime >= range.end && !seekTo(range.start))
            return range;
          void player.play().catch(() => {
            if (mounted && current.current.active && version === playRequest) setPlayFailed(true);
          });
        }
        boundary();
      }
      return range;
    };
    apply.current = update;
    const metadata = () => {
      setReady(true);
      update(request);
    };
    const canPlay = () => {
      if (waiting) update(request);
    };
    const play = () => {
      if (!current.current.active || (range.end !== undefined && range.end <= range.start)) {
        player.pause();
        return;
      }
      setPlayFailed(false);
      if (
        (player.currentTime < range.start ||
          (range.end !== undefined && player.currentTime >= range.end)) &&
        !seekTo(range.start)
      )
        return;
      boundary();
    };
    const fail = () => {
      setFailed(true);
      stopTimer();
    };
    player.addEventListener("error", fail);
    player.addEventListener("loadedmetadata", metadata);
    player.addEventListener("canplay", canPlay);
    player.addEventListener("play", play);
    player.addEventListener("pause", stopTimer);
    player.addEventListener("seeked", boundary);
    player.addEventListener("timeupdate", boundary);
    player.addEventListener("ratechange", boundary);
    player.src = source;
    return () => {
      mounted = false;
      apply.current = null;
      stopTimer();
      player.removeEventListener("error", fail);
      player.removeEventListener("loadedmetadata", metadata);
      player.removeEventListener("canplay", canPlay);
      player.removeEventListener("play", play);
      player.removeEventListener("pause", stopTimer);
      player.removeEventListener("seeked", boundary);
      player.removeEventListener("timeupdate", boundary);
      player.removeEventListener("ratechange", boundary);
      player.pause();
      player.removeAttribute("src");
      player.load();
    };
  }, [source, kind]);

  useEffect(() => {
    const last = previous.current;
    previous.current = { start, end, position, playing };
    apply.current?.(
      previous.current,
      start !== last.start || end !== last.end || position !== last.position,
    );
  }, [start, end, position, playing]);

  useEffect(() => {
    if (!active) (kind === "video" ? video.current : audio.current)?.pause();
  }, [active, kind]);

  const left = rangeAnchor?.left;
  const top = rangeAnchor?.top;
  useEffect(() => {
    const player = kind === "video" ? video.current : audio.current;
    if (left !== undefined && top !== undefined && player)
      setFields((fields) => ({ ...fields, position: String(player.currentTime) }));
  }, [left, top, kind]);

  const rangeLabel = t("filePreview.mediaRange", { defaultValue: "Playback range" });
  const rangeForm = (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (
          [...event.currentTarget.querySelectorAll("input")].some(
            (input) => input.validity.badInput,
          )
        ) {
          setInvalid(true);
          return;
        }
        const start = fields.start.trim() ? Number(fields.start) : 0;
        const next = apply.current?.({
          start,
          end: fields.end.trim() ? Number(fields.end) : undefined,
          position: fields.position.trim() ? Number(fields.position) : start,
        });
        if (next) {
          onPlaybackChange?.(next);
          onCloseRange?.();
        }
      }}
    >
      {(["position", "start", "end"] as const).map((field) => (
        <TextField
          key={field}
          size="small"
          type="number"
          label={t(`filePreview.media${field[0].toUpperCase()}${field.slice(1)}`, {
            defaultValue: `${field[0].toUpperCase()}${field.slice(1)} (s)`,
          })}
          value={fields[field]}
          disabled={!ready || failed}
          slotProps={{ htmlInput: { min: 0, step: "any" } }}
          onChange={(event) => setFields((fields) => ({ ...fields, [field]: event.target.value }))}
        />
      ))}
      <Button type="submit" size="small" disabled={!ready || failed}>
        {t("filePreview.mediaApply", { defaultValue: "Apply" })}
      </Button>
      {invalid && (
        <p className="file-preview__media-error" role="alert">
          {t("filePreview.mediaRangeInvalid", {
            defaultValue:
              "Enter nonnegative seconds, with end after start and position inside the range.",
          })}
        </p>
      )}
    </form>
  );

  return (
    <div className={`file-preview__media file-preview__media--${kind} nodrag nopan nowheel`}>
      {kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: Local files do not provide a separate caption track.
        <video ref={video} controls playsInline preload="metadata" aria-label={name} />
      ) : (
        <>
          {rangeAnchor === undefined && <span className="file-preview__media-name">{name}</span>}
          {/* biome-ignore lint/a11y/useMediaCaption: Local files do not provide a separate caption track. */}
          <audio ref={audio} controls preload="metadata" aria-label={name} />
        </>
      )}
      {rangeAnchor === undefined ? (
        <details
          className="file-preview__media-range"
          onToggle={(event) => {
            const player = kind === "video" ? video.current : audio.current;
            if (event.currentTarget.open && player)
              setFields((fields) => ({ ...fields, position: String(player.currentTime) }));
          }}
        >
          <summary>{rangeLabel}</summary>
          {rangeForm}
        </details>
      ) : (
        <Popover
          open={rangeAnchor !== null}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
          container={() =>
            (kind === "video" ? video.current : audio.current)?.closest("dialog[open]") ??
            document.body
          }
          anchorReference="anchorPosition"
          anchorPosition={rangeAnchor ?? undefined}
          onClose={onCloseRange}
          slotProps={{
            paper: {
              className: "file-preview__media-range file-preview__media-range--popover",
              role: "dialog",
              "aria-label": rangeLabel,
            },
          }}
        >
          {rangeForm}
        </Popover>
      )}
      {playFailed && !failed && (
        <p className="file-preview__media-error" role="alert">
          {t("filePreview.mediaPlayFailed", {
            defaultValue: "Playback could not start. Use the player’s Play button to try again.",
          })}
        </p>
      )}
      {seekFailed && !failed && (
        <p className="file-preview__media-error" role="alert">
          {t("filePreview.mediaSeekFailed", {
            defaultValue:
              "This source cannot seek to that position. Try again after it loads, or open a local copy.",
          })}
        </p>
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
