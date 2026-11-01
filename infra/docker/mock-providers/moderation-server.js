/**
 * Mock moderation provider HTTP server.
 *
 * Listens on port 9100. Always returns a safe classification so local development
 * never triggers automated actions. A query parameter `?inject=nudity_explicit` can
 * be used in integration tests to inject a specific label.
 */

import http from "node:http";

const PORT = 9100;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const inject = url.searchParams.get("inject");

    const label = inject ?? "safe";
    const score = inject ? 0.95 : 0.01;

    const response = {
      status: { code: 200 },
      message: "mock_ok",
      output: [
        {
          classes: [{ class: label, score }],
        },
      ],
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
});

server.listen(PORT, () => {
  console.log(`Mock moderation provider listening on :${PORT}`);
});
