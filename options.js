const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:8080/v1/chat/completions",
  model: "mlx-community/Llama-3.2-3B-Instruct-4bit",
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

document.getElementById("save").addEventListener("click", save);
load();
