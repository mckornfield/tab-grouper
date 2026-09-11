# Tab Grouper

Chrome MV3 extension that groups open tabs by category using a local (or hosted) OpenAI-compatible chat completions endpoint.

## Setup: NVIDIA-hosted endpoint (default, no local model needed)

The extension defaults to NVIDIA's hosted OpenAI-compatible API:

1. Get an API key from [build.nvidia.com](https://build.nvidia.com).
2. Load the extension:
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select this directory
3. Right-click the extension icon → Options, and set:
   - **Endpoint:** `https://integrate.api.nvidia.com/v1/chat/completions` (default)
   - **Model:** `nvidia/nemotron-3.5-lightning-30b-a3b` (default) — or any other chat model listed on build.nvidia.com
   - **API key:** your NVIDIA API key
4. Save, then click the extension's toolbar icon to group the tabs in the current window.

## Setup: local MLX instead

MLX is Apple's Metal-native ML framework — on Apple Silicon it's typically faster than llama.cpp/Ollama, and `mlx_lm.server` speaks the same OpenAI-compatible API this extension expects.

1. Install and run the server:
   ```
   pip install mlx-lm
   mlx_lm.server --model mlx-community/Llama-3.2-3B-Instruct-4bit --port 8080
   ```
2. **Keeping it "hot":** unlike Ollama, `mlx_lm.server` has no idle-unload timer — the model stays resident in memory for as long as the process runs, so the first click after startup is the only slow one. Options to keep it running:
   - Simplest: leave the `mlx_lm.server` terminal/tab running in the background while you work.
   - Persistent across logins/reboots: run it as a `launchd` agent (`~/Library/LaunchAgents/com.local.mlx-server.plist`) with `KeepAlive: true` so macOS restarts it if it dies. Ask me and I'll generate the plist.
3. In Options, set endpoint to `http://localhost:8080/v1/chat/completions` and model to `mlx-community/Llama-3.2-3B-Instruct-4bit`, leave API key blank.

If you point the endpoint at a different host entirely (not localhost or `integrate.api.nvidia.com`), add it to `host_permissions` in `manifest.json` and reload the extension, or Chrome will block the request.

## How it works

- `background.js` queries tabs in the current window that aren't already in a group (pinned tabs and chrome:// tabs are skipped too), along with the titles of any existing tab groups, and sends both to the configured chat completions endpoint, asking for a JSON mapping of tab ID → category.
- If a tab's category matches an existing group's title (case-insensitive), it's added to that group instead of creating a duplicate. New categories only form a group once they have 2+ tabs.
- Any OpenAI-compatible `/v1/chat/completions` endpoint works — MLX, Ollama (with its OpenAI-compat routes), LM Studio, or NVIDIA's hosted API — just update the endpoint/model/API key in Options.
- Tabs are grouped via `chrome.tabs.group` / `chrome.tabGroups.update`.
- If the request fails, the toolbar icon shows a red "!" badge — check the service worker console at `chrome://extensions` for details.
