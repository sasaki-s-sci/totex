import i18next from "i18next";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { MediaReading } from "../../src/canvas/nodes/preview/MediaReading";
import en from "../../src/i18n/locales/en.json";
import type { MediaPlayback } from "../../src/lib/media";

declare global {
  interface Window {
    setMediaPlayback: (next: MediaPlayback) => void;
  }
}

void i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });

// Two seconds of silent PCM exercise decoding without a binary fixture or audible playback.
const samples = 16000;
const bytes = new Uint8Array(44 + samples * 2);
const header = new DataView(bytes.buffer);
function word(offset: number, value: string) {
  bytes.set(new TextEncoder().encode(value), offset);
}
word(0, "RIFF");
header.setUint32(4, bytes.length - 8, true);
word(8, "WAVEfmt ");
header.setUint32(16, 16, true);
header.setUint16(20, 1, true);
header.setUint16(22, 1, true);
header.setUint32(24, 8000, true);
header.setUint32(28, 16000, true);
header.setUint16(32, 2, true);
header.setUint16(34, 16, true);
word(36, "data");
header.setUint32(40, samples * 2, true);
const source = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
const broken = "data:application/octet-stream;base64,YnJva2Vu";
const nonseekable = new URLSearchParams(location.search).has("nonseekable");

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(true);
  const [playback, setPlayback] = useState<MediaPlayback | undefined>(
    nonseekable
      ? { start: 0.3, end: 1.5, position: 0.8 }
      : location.search
        ? { start: 0.25, end: 4, position: 3 }
        : undefined,
  );
  const [changes, setChanges] = useState<MediaPlayback[]>([]);
  useEffect(() => {
    window.setMediaPlayback = setPlayback;
  }, []);
  return (
    <>
      <button type="button" onClick={() => setVisible(!visible)}>
        Toggle viewers
      </button>
      <button type="button" onClick={() => setFailed(!failed)}>
        Toggle broken
      </button>
      <button type="button" onClick={() => setActive(!active)}>
        Toggle active
      </button>
      <output data-testid="changes">{JSON.stringify(changes)}</output>
      {visible && (
        <>
          <section aria-label="Audio" style={{ width: 400, height: 280 }}>
            <MediaReading
              source={failed ? broken : source}
              name="sample.wav"
              kind="audio"
              playback={playback}
              active={active}
              onPlaybackChange={(next) => {
                setPlayback(next);
                setChanges((changes) => [...changes, next]);
              }}
            />
          </section>
          <section aria-label="Video" style={{ width: 400, height: 240 }}>
            <MediaReading
              source={nonseekable ? "/tests/fixtures/media-no-range.webm" : broken}
              name={nonseekable ? "sample.webm" : "broken.webm"}
              kind="video"
              playback={nonseekable ? playback : undefined}
            />
          </section>
        </>
      )}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
