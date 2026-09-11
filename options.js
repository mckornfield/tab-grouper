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

document.getElementById("save").addEventListener("click", save);
load();
