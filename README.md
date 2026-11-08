# Standalone Codex WebUI feasibility harness

Node.js 22 tools for testing reuse of the packaged desktop renderer and central manager. **This is not a usable WebUI yet; the two-browser proof gate has not passed.**

```sh
npm ci
npm run assets:prepare
npm run assets:check
npm test
npm run compat:check
npm run dev
```

Asset preparation defaults to `chatgpt/usr/lib/chatgpt/resources/app.asar`; pass another archive path after `--`. Original assets remain unchanged and generated assets stay out of Git. The compatibility check deliberately exits `2` for the unadapted manager's DOM dependency; its report also records a narrowly adapted import experiment.

The browser feasibility host listens on `0.0.0.0:3000`; `HOST` and `PORT` override it. It displays explicit diagnostics while host services remain unavailable. See [network setup](docs/network.md) for access and connection checks.

See [feasibility findings](docs/feasibility.md) and [host contracts](docs/contracts.md) for current results and remaining work.
