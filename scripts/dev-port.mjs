/**
 * Prints a port nobody is listening on.
 *
 * Asked of the operating system rather than guessed at: binding to port zero
 * hands back one that was free at that instant, which is the only answer that
 * is not a hopeful assumption. `task dev` gives the same number to both halves
 * of the pair, so the window and the dev server always agree on it.
 *
 * There is a gap between letting go of the port and vite taking it, and nothing
 * can close it — but it is microseconds wide, and the alternative is the fixed
 * port that a dev server from an hour ago is still sitting on.
 */

import { createServer } from "node:net";

const server = createServer();

server.on("error", (error) => {
  process.stderr.write(`could not reserve a port: ${error.message}\n`);
  process.exit(1);
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  server.close(() => process.stdout.write(String(port)));
});
