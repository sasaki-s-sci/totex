export type MediaPlayback = {
  start?: number;
  end?: number;
  position?: number;
  playing?: boolean;
};

export function normalizeMediaPlayback(playback: MediaPlayback, duration = Infinity) {
  const { start = 0, end, position = start, playing } = playback;
  if (
    [start, end, position].some(
      (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
    ) ||
    (end !== undefined && end <= start) ||
    position < start ||
    (end !== undefined && position > end) ||
    (playing !== undefined && typeof playing !== "boolean")
  )
    throw new Error("Invalid media playback range.");
  const limit = Number.isFinite(duration) && duration >= 0 ? duration : Infinity;
  const first = Math.min(start, limit);
  const last = Math.min(end ?? limit, limit);
  return {
    start: first,
    ...(Number.isFinite(last) ? { end: last } : {}),
    position: Math.max(first, Math.min(position, last)),
    ...(playing === undefined ? {} : { playing }),
  };
}
