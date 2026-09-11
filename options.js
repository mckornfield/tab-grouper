const DEFAULT_SETTINGS = {
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  apiKey: "",
};

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById("endpoint").value = settings.endpoint;
  document.getElementById("model").value = settings.model;
  document.getElementById("apiKey").value = settings.apiKey;
}

async function save() {
  const endpoint = document.getElementById("endpoint").value.trim();
  const model = document.getElementById("model").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  await chrome.storage.sync.set({ endpoint, model, apiKey });
  const status = document.getElementById("status");
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1500);
}

const TEST_TIMEOUT_MS = 15000;

async function test() {
  const endpoint = document.getElementById("endpoint").value.trim();
  const model = document.getElementById("model").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const testStatus = document.getElementById("testStatus");

  testStatus.className = "pending";
  testStatus.textContent = "Testing...";

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const start = performance.now();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "detailed thinking off" },
          { role: "user", content: "Reply with only the word: pong" },
        ],
        temperature: 0,
        stream: false,
        max_tokens: 64,
      }),
      signal: controller.signal,
    });

    const elapsed = Math.round(performance.now() - start);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "(no content)";
    testStatus.className = "ok";
    testStatus.textContent = `OK (${elapsed}ms) — model replied: "${content.trim()}"`;
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    testStatus.className = "err";
    testStatus.textContent =
      err.name === "AbortError"
        ? `Timed out after ${TEST_TIMEOUT_MS / 1000}s`
        : `Failed after ${elapsed}ms: ${err.message}`;
  } finally {
    clearTimeout(timeout);
  }
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("test").addEventListener("click", test);
load();
