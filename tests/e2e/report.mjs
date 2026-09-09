import { writeFileSync } from "node:fs";
import { join } from "node:path";

const htmlEscape = (value) =>
  String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });

export function writeReport(directory, result) {
  writeFileSync(join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    join(directory, "index.html"),
    `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>totex E2E — ${htmlEscape(result.status)}</title>
<style>
body { font: 16px system-ui; max-width: 1100px; margin: 32px auto; padding: 0 20px; background: #171a20; color: #eef0f4; }
a { color: #9acbff; } video, img { width: 100%; background: #000; border-radius: 8px; }
li { margin: 12px 0; } pre { white-space: pre-wrap; overflow-wrap: anywhere; color: #ffb4ab; }
small { color: #b9c0cc; } button { cursor: pointer; padding: 4px 8px; }
</style>
<h1>totex 動作確認 — ${htmlEscape(result.status)}</h1>
<p>実アプリの UI → Rust → Git・PTY を操作する Linux E2E テスト</p>
<small>${htmlEscape(result.started)} · commit ${htmlEscape(result.commit)}</small>
${result.video ? '<video id="recording" controls preload="metadata" src="recording.mp4"></video>' : "<p>動画を生成できませんでした。</p>"}
<ol>${result.steps
      .map(
        (
          step,
        ) => `<li><button type="button" data-time="${step.videoSeconds}">▶ ${step.videoSeconds.toFixed(1)}s</button>
${htmlEscape(step.name)} — ${htmlEscape(step.status)}
${step.screenshot ? `<a href="${htmlEscape(step.screenshot)}">画像</a>` : ""}
${step.error ? `<pre>${htmlEscape(step.error)}</pre>` : ""}</li>`,
      )
      .join("\n")}</ol>
${result.error ? `<pre>${htmlEscape(result.error)}</pre>` : ""}
<p><a href="result.json">結果JSON</a> · <a href="driver.log">アプリ・WebDriverログ</a> ·
<a href="recorder.log">録画ログ</a> · <a href="display.log">仮想画面ログ</a></p>
<script>
document.querySelectorAll('[data-time]').forEach(button => button.addEventListener('click', () => {
  const video = document.getElementById('recording');
  if (video) { video.currentTime = Number(button.dataset.time); video.play(); }
}));
</script></html>`,
  );
}
