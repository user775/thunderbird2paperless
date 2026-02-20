const form = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url");
const apiTokenInput = document.getElementById("api-token");
const testConnectionButton = document.getElementById("test-connection");
const connectionStatusEl = document.getElementById("connection-status");
const titlePrefixInput = document.getElementById("title-prefix");
const confirmBeforeUploadInput = document.getElementById("confirm-before-upload");
const defaultCorrespondentNameInput = document.getElementById("default-correspondent-name");
const defaultDocumentTypeNameInput = document.getElementById("default-document-type-name");
const defaultTagNamesInput = document.getElementById("default-tag-names");
const correspondentsList = document.getElementById("correspondents-list");
const documentTypesList = document.getElementById("document-types-list");
const statusEl = document.getElementById("status");

let lookups = {
  correspondents: [],
  documentTypes: [],
  tags: []
};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a4000f" : "#0a6700";
}

function setConnectionStatus(message, isError = false) {
  connectionStatusEl.textContent = message;
  connectionStatusEl.style.color = isError ? "#a4000f" : "#0a6700";
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}

function tokenizeCommaList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPositiveIntegerString(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0;
}

function findByNameOrId(items, raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return null;
  }

  if (isPositiveIntegerString(value)) {
    const id = Number(value);
    return items.find((item) => item.id === id) || { id, name: value };
  }

  const lowered = value.toLowerCase();
  return items.find((item) => String(item.name || "").toLowerCase() === lowered) || null;
}

function fillDatalist(listEl, items) {
  listEl.textContent = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.name;
    listEl.appendChild(option);
  }
}

function tagIdsToNames(tagIds) {
  return (Array.isArray(tagIds) ? tagIds : [])
    .map((id) => lookups.tags.find((tag) => tag.id === Number(id)))
    .filter(Boolean)
    .map((tag) => tag.name)
    .join(", ");
}

async function fetchLookupsFromBackground(force = false) {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  const apiToken = apiTokenInput.value.trim();
  if (!apiToken) {
    throw new Error("API token is required.");
  }

  const response = await messenger.runtime.sendMessage({
    type: "paperless.testConnection",
    serverUrl,
    apiToken,
    force
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Failed to fetch lookup data.");
  }

  lookups = response.lookups;
  fillDatalist(correspondentsList, lookups.correspondents);
  fillDatalist(documentTypesList, lookups.documentTypes);
}

function resolveFormMetadataToIds() {
  const correspondent = findByNameOrId(lookups.correspondents, defaultCorrespondentNameInput.value);
  const documentType = findByNameOrId(lookups.documentTypes, defaultDocumentTypeNameInput.value);

  const tagIds = tokenizeCommaList(defaultTagNamesInput.value).map((token) => {
    const matched = findByNameOrId(lookups.tags, token);
    if (!matched) {
      throw new Error(`Unknown tag: ${token}`);
    }
    return matched.id;
  });

  return {
    defaultCorrespondentId: correspondent ? String(correspondent.id) : "",
    defaultDocumentTypeId: documentType ? String(documentType.id) : "",
    defaultTagIds: tagIds.join(",")
  };
}

async function loadSettings() {
  const data = await messenger.storage.local.get({
    serverUrl: "",
    apiToken: "",
    titlePrefix: "",
    confirmBeforeUpload: true,
    defaultCorrespondentId: "",
    defaultDocumentTypeId: "",
    defaultTagIds: ""
  });

  serverUrlInput.value = data.serverUrl || "";
  apiTokenInput.value = data.apiToken || "";
  titlePrefixInput.value = data.titlePrefix || "";
  confirmBeforeUploadInput.checked = data.confirmBeforeUpload !== false;

  if (data.serverUrl && data.apiToken) {
    try {
      await fetchLookupsFromBackground();
      const correspondent = lookups.correspondents.find((item) => item.id === Number(data.defaultCorrespondentId));
      const documentType = lookups.documentTypes.find((item) => item.id === Number(data.defaultDocumentTypeId));
      const tagIds = tokenizeCommaList(data.defaultTagIds).map((value) => Number(value));

      defaultCorrespondentNameInput.value = correspondent ? correspondent.name : data.defaultCorrespondentId || "";
      defaultDocumentTypeNameInput.value = documentType ? documentType.name : data.defaultDocumentTypeId || "";
      defaultTagNamesInput.value = tagIdsToNames(tagIds) || data.defaultTagIds || "";
      setConnectionStatus("Connection verified.");
    } catch (error) {
      defaultCorrespondentNameInput.value = data.defaultCorrespondentId || "";
      defaultDocumentTypeNameInput.value = data.defaultDocumentTypeId || "";
      defaultTagNamesInput.value = data.defaultTagIds || "";
      setConnectionStatus(error.message || "Connection test failed.", true);
    }
  }
}

testConnectionButton.addEventListener("click", async () => {
  try {
    setConnectionStatus("Testing...");
    await fetchLookupsFromBackground(true);
    setConnectionStatus("Connected. Lookup lists refreshed.");
  } catch (error) {
    setConnectionStatus(error.message || "Connection test failed.", true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const serverUrl = normalizeUrl(serverUrlInput.value);
    const apiToken = apiTokenInput.value.trim();
    const titlePrefix = titlePrefixInput.value;
    const confirmBeforeUpload = confirmBeforeUploadInput.checked;

    if (!apiToken) {
      throw new Error("API token is required.");
    }

    if (!lookups.correspondents.length && !lookups.documentTypes.length && !lookups.tags.length) {
      await fetchLookupsFromBackground();
    }

    const resolved = resolveFormMetadataToIds();

    await messenger.storage.local.set({
      serverUrl,
      apiToken,
      titlePrefix,
      confirmBeforeUpload,
      defaultCorrespondentId: resolved.defaultCorrespondentId,
      defaultDocumentTypeId: resolved.defaultDocumentTypeId,
      defaultTagIds: resolved.defaultTagIds
    });

    setStatus("Settings saved.");
  } catch (error) {
    setStatus(error.message || "Failed to save settings.", true);
  }
});

loadSettings().catch((error) => {
  setStatus(error.message || "Failed to load settings.", true);
});
