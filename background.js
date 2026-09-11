const DEFAULT_SETTINGS = {
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  apiKey: "",
  categories: "",
};

const GROUP_COLORS = [
  "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey",
];

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function buildPrompt(tabs, existingGroupTitles, fixedCategories) {
  const tabList = tabs
    .map((t) => `${t.id}\t${t.title}\t${t.url}`)
    .join("\n");

  const existingSection = existingGroupTitles.length
    ? `\nExisting tab groups already open: ${existingGroupTitles.join(", ")}.
If a tab clearly belongs in one of these, reuse that exact category name so it gets added to the existing group instead of creating a duplicate.\n`
    : "";

  const categorySection = fixedCategories.length
    ? `\nYou MUST assign every tab to exactly one of these categories, choosing the closest fit even if the match is loose: ${fixedCategories.join(", ")}.\n`
    : `\nUse a short category label (1-3 words, e.g. "Shopping", "Docs", "Social Media", "Work") and use as few distinct categories as reasonable.\n`;

  return `You are categorizing browser tabs into short topical groups.
Given the tabs below (tab_id, title, url), assign each tab_id to a category.
${categorySection}${existingSection}
Respond with ONLY a JSON object mapping tab_id (string) to category (string), no other text. Every tab_id below must appear as a key.

Tabs:
${tabList}`;
}

function snapToFixedCategory(category, fixedCategories) {
  if (!fixedCategories.length) return category;
  const norm = category.trim().toLowerCase();

  const exact = fixedCategories.find((fc) => fc.toLowerCase() === norm);
  if (exact) return exact;

  // Model drifted from the configured list (e.g. "GitHub" instead of "Docs") —
  // snap to the closest configured category by substring overlap rather than
  // letting it become a stray one-off category.
  const substring = fixedCategories.find((fc) => {
    const fcNorm = fc.toLowerCase();
    return norm.includes(fcNorm) || fcNorm.includes(norm);
  });
  if (substring) return substring;

  return category;
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
        // Nemotron models can emit a long internal reasoning trace by default,
        // which blows up latency for a simple classification task. Turn it off.
        messages: [
          { role: "system", content: "detailed thinking off" },
          { role: "user", content: prompt },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 1024,
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

  const currentWindow = await chrome.windows.get(tabs[0].windowId);
  if (currentWindow.type !== "normal") {
    throw new Error(
      `This is a "${currentWindow.type}" window — tab grouping only works in a regular browser window. Click the icon from a normal window instead.`
    );
  }

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

  const fixedCategories = (settings.categories || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const fixedCategoriesLower = new Set(fixedCategories.map((c) => c.toLowerCase()));

  const existingTitles = existingGroups.map((g) => g.title).filter(Boolean);
  console.log(`Tab Grouper: sending ${groupable.length} tabs to ${settings.endpoint} (${settings.model})... existing groups: ${existingTitles.join(", ") || "none"}, fixed categories: ${fixedCategories.join(", ") || "none"}`);
  const prompt = buildPrompt(groupable, existingTitles, fixedCategories);
  const assignments = await callChatCompletions(settings, prompt);
  console.log("Tab Grouper: got category assignments:", assignments);

  const byCategory = new Map();
  for (const tab of groupable) {
    let category = assignments[String(tab.id)];
    if (!category) continue;
    category = snapToFixedCategory(category, fixedCategories);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(tab.id);
  }

  let colorIndex = 0;
  let groupsCreated = 0;
  let addedToExisting = 0;
  for (const [category, tabIds] of byCategory) {
    const existing = existingByTitle.get(category.toLowerCase());
    if (existing) {
      try {
        await chrome.tabs.group({ tabIds, groupId: existing.id });
        addedToExisting += tabIds.length;
        continue;
      } catch (err) {
        // Group may have been closed/emptied since we queried it — fall back
        // to creating a fresh group instead of failing the whole run.
        console.warn(`Tab Grouper: existing group "${category}" is stale, creating a new one instead:`, err);
        existingByTitle.delete(category.toLowerCase());
      }
    }

    // Ad-hoc/freeform categories need 2+ tabs to avoid singleton clutter, but
    // a category the user explicitly configured is a group they always want.
    if (tabIds.length < 2 && !fixedCategoriesLower.has(category.toLowerCase())) continue;
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
