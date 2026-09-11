const DEFAULT_SETTINGS = {
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  apiKey: "",
};

const GROUP_COLORS = [
  "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey",
];

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function buildPrompt(tabs, existingGroupTitles) {
  const tabList = tabs
    .map((t) => `${t.id}\t${t.title}\t${t.url}`)
    .join("\n");

  const existingSection = existingGroupTitles.length
    ? `\nExisting tab groups already open: ${existingGroupTitles.join(", ")}.
If a tab clearly belongs in one of these, reuse that exact category name so it gets added to the existing group instead of creating a duplicate. Otherwise pick a new short category.\n`
    : "";

  return `You are categorizing browser tabs into short topical groups.
Given the tabs below (tab_id, title, url), assign each tab_id to a short category label (1-3 words, e.g. "Shopping", "Docs", "Social Media", "Work").
Use as few distinct categories as reasonable.
${existingSection}
Respond with ONLY a JSON object mapping tab_id (string) to category (string), no other text.

Tabs:
${tabList}`;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Model response did not contain JSON: ${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

const REQUEST_TIMEOUT_MS = 60000;

async function callChatCompletions({ endpoint, model, apiKey }, prompt) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        temperature: 0,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Chat completions request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in model response");
  return extractJson(content);
}

async function groupTabs() {
  const settings = await getSettings();
  console.log("Tab Grouper: querying tabs...");
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length === 0) return;

  const existingGroups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
  const existingByTitle = new Map(
    existingGroups.filter((g) => g.title).map((g) => [g.title.toLowerCase(), g])
  );

  // Only categorize tabs not already in a group, so manually-organized groups are left alone.
  const groupable = tabs.filter(
    (t) => t.url && !t.url.startsWith("chrome://") && !t.pinned && t.groupId === -1
  );
  if (groupable.length === 0) {
    console.log("Tab Grouper: no groupable tabs, nothing to do.");
    return;
  }

  const existingTitles = existingGroups.map((g) => g.title).filter(Boolean);
  console.log(`Tab Grouper: sending ${groupable.length} tabs to ${settings.endpoint} (${settings.model})... existing groups: ${existingTitles.join(", ") || "none"}`);
  const prompt = buildPrompt(groupable, existingTitles);
  const assignments = await callChatCompletions(settings, prompt);
  console.log("Tab Grouper: got category assignments:", assignments);

  const byCategory = new Map();
  for (const tab of groupable) {
    const category = assignments[String(tab.id)];
    if (!category) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(tab.id);
  }

  let colorIndex = 0;
  let groupsCreated = 0;
  let addedToExisting = 0;
  for (const [category, tabIds] of byCategory) {
    const existing = existingByTitle.get(category.toLowerCase());
    if (existing) {
      await chrome.tabs.group({ tabIds, groupId: existing.id });
      addedToExisting += tabIds.length;
      continue;
    }

    if (tabIds.length < 2) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: category,
      color: GROUP_COLORS[colorIndex % GROUP_COLORS.length],
    });
    colorIndex++;
    groupsCreated++;
  }
  console.log(`Tab Grouper: created ${groupsCreated} group(s), added ${addedToExisting} tab(s) to existing groups.`);
}

let running = false;

chrome.action.onClicked.addListener(() => {
  if (running) {
    console.log("Tab Grouper: already running, ignoring click.");
    return;
  }
  running = true;

  chrome.action.setBadgeText({ text: "..." });
  chrome.action.setBadgeBackgroundColor({ color: "#888" });

  groupTabs()
    .then(() => {
      chrome.action.setBadgeText({ text: "✓" });
      chrome.action.setBadgeBackgroundColor({ color: "#2a2" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
    })
    .catch((err) => {
      console.error("Tab Grouper failed:", err);
      chrome.action.setBadgeText({ text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#d33" });
    })
    .finally(() => {
      running = false;
    });
});
