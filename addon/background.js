const MENU_UPLOAD_ONE = "upload-attachment-to-paperless";
const MENU_UPLOAD_ALL = "upload-all-attachments-to-paperless";

const confirmationSessions = new Map();
let lookupCache = null;

function normalizeBaseUrl(rawUrl) {
  const url = (rawUrl || "").trim().replace(/\/$/, "");
  if (!url) {
    throw new Error("Paperless URL is not configured.");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Paperless URL is invalid.");
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    throw new Error("Paperless URL must use http or https.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function parseOptionalPositiveInt(rawValue, label) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function parseTagIds(rawTagIds) {
  const raw = String(rawTagIds ?? "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error("Tag IDs must be comma-separated positive integers.");
      }
      return id;
    });
}

function formatTagIds(tagIds) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return "";
  }

  return tagIds.join(", ");
}

function buildDefaultTitle(subject, attachmentName, titlePrefix) {
  const cleanSubject = String(subject || "").trim();
  const cleanAttachment = String(attachmentName || "attachment").trim() || "attachment";
  const base = cleanSubject ? `${cleanSubject} - ${cleanAttachment}` : cleanAttachment;
  const prefix = String(titlePrefix || "").trim();
  return `${prefix}${base}`;
}

function createNonce() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function splitNameList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function findByNameOrId(items, rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return items.find((item) => item.id === numeric) || { id: numeric, name: value };
  }

  const lowered = value.toLowerCase();
  return items.find((item) => String(item.name || "").toLowerCase() === lowered) || null;
}

function tagIdsToNames(tagIds, tags) {
  return (Array.isArray(tagIds) ? tagIds : [])
    .map((id) => tags.find((tag) => tag.id === id))
    .filter(Boolean)
    .map((tag) => tag.name)
    .join(", ");
}

async function fetchJson(url, apiToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${apiToken}`
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Request failed (${response.status}). ${detail.slice(0, 250)}`);
  }

  return response.json();
}

async function fetchPaginated(serverUrl, apiToken, path) {
  const items = [];
  let nextUrl = `${serverUrl}${path}${path.includes("?") ? "&" : "?"}page_size=200`;

  while (nextUrl) {
    const page = await fetchJson(nextUrl, apiToken);
    const pageItems = Array.isArray(page.results) ? page.results : [];

    for (const item of pageItems) {
      items.push({
        id: item.id,
        name: item.name || item.title || String(item.id)
      });
    }

    nextUrl = page.next || null;
  }

  return items;
}

async function fetchLookups(settings, force = false) {
  const cacheKey = `${settings.serverUrl}|${settings.apiToken}`;
  const now = Date.now();

  if (
    !force &&
    lookupCache &&
    lookupCache.key === cacheKey &&
    now - lookupCache.timestamp < 5 * 60 * 1000
  ) {
    return lookupCache.value;
  }

  const [correspondents, documentTypes, tags] = await Promise.all([
    fetchPaginated(settings.serverUrl, settings.apiToken, "/api/correspondents/"),
    fetchPaginated(settings.serverUrl, settings.apiToken, "/api/document_types/"),
    fetchPaginated(settings.serverUrl, settings.apiToken, "/api/tags/")
  ]);

  const value = { correspondents, documentTypes, tags };
  lookupCache = {
    key: cacheKey,
    timestamp: now,
    value
  };
  return value;
}

async function testConnection(settings) {
  await fetchJson(`${settings.serverUrl}/api/documents/?page_size=1`, settings.apiToken);
}

async function getSettings() {
  const data = await messenger.storage.local.get({
    serverUrl: "",
    apiToken: "",
    titlePrefix: "",
    confirmBeforeUpload: true,
    defaultCorrespondentId: "",
    defaultDocumentTypeId: "",
    defaultTagIds: ""
  });

  if (!data.serverUrl || !data.apiToken) {
    throw new Error("Paperless settings are incomplete. Configure server URL and API token in add-on preferences.");
  }

  return {
    serverUrl: normalizeBaseUrl(data.serverUrl),
    apiToken: data.apiToken.trim(),
    titlePrefix: (data.titlePrefix || "").trim(),
    confirmBeforeUpload: data.confirmBeforeUpload !== false,
    defaultCorrespondentId: parseOptionalPositiveInt(data.defaultCorrespondentId, "Default correspondent ID"),
    defaultDocumentTypeId: parseOptionalPositiveInt(data.defaultDocumentTypeId, "Default document type ID"),
    defaultTagIds: parseTagIds(data.defaultTagIds)
  };
}

function formatDateForPaperless(dateValue) {
  if (!dateValue) {
    return "";
  }

  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function inferMessageId(info, tab) {
  const first = info.attachments && info.attachments[0];
  if (first && first.message && first.message.id) {
    return first.message.id;
  }

  const selectedFromInfo = info.selectedMessages && info.selectedMessages.messages;
  if (selectedFromInfo && selectedFromInfo.length > 0) {
    return selectedFromInfo[0].id;
  }

  async function fromTabId(tabId) {
    if (typeof tabId !== "number") {
      return null;
    }

    try {
      const displayed = await messenger.messageDisplay.getDisplayedMessage(tabId);
      if (displayed && displayed.id) {
        return displayed.id;
      }
    } catch {
      // Ignore and try other strategies.
    }

    try {
      const selected = await messenger.mailTabs.getSelectedMessages(tabId);
      if (selected && selected.messages && selected.messages.length > 0) {
        return selected.messages[0].id;
      }
    } catch {
      // Ignore and try other strategies.
    }

    return null;
  }

  if (tab && typeof tab.id === "number") {
    const fromClickedTab = await fromTabId(tab.id);
    if (fromClickedTab) {
      return fromClickedTab;
    }
  }

  try {
    const activeMailTabs = await messenger.mailTabs.query({
      active: true,
      currentWindow: true
    });
    for (const mailTab of activeMailTabs) {
      const id = await fromTabId(mailTab.id);
      if (id) {
        return id;
      }
    }
  } catch {
    // Ignore and fall through to null.
  }

  return null;
}

async function uploadAttachment({ file, originalName, messageDate, settings, metadata }) {
  const endpoint = `${settings.serverUrl}/api/documents/post_document/`;
  const formData = new FormData();
  formData.append("document", file, originalName || file.name || "attachment");

  if (metadata.title) {
    formData.append("title", metadata.title);
  }

  if (metadata.correspondentId) {
    formData.append("correspondent", String(metadata.correspondentId));
  }

  if (metadata.documentTypeId) {
    formData.append("document_type", String(metadata.documentTypeId));
  }

  if (Array.isArray(metadata.tagIds)) {
    for (const tagId of metadata.tagIds) {
      formData.append("tags", String(tagId));
    }
  }

  const created = formatDateForPaperless(messageDate);
  if (created) {
    formData.append("created", created);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Token ${settings.apiToken}`
    },
    body: formData
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upload failed (${response.status}). ${detail.slice(0, 250)}`);
  }
}

async function notify(title, message) {
  await messenger.notifications.create({
    type: "basic",
    title,
    message
  });
}

async function requestUploadMetadata(defaults, attachmentName, lookups, isBulk) {
  const nonce = createNonce();
  const url = messenger.runtime.getURL(
    `confirm.html?nonce=${encodeURIComponent(nonce)}&attachment=${encodeURIComponent(attachmentName || "attachment")}&bulk=${isBulk ? "1" : "0"}`
  );

  return new Promise((resolve, reject) => {
    const session = {
      defaults,
      lookups,
      resolve,
      reject,
      windowId: null
    };

    confirmationSessions.set(nonce, session);

    messenger.windows
      .create({
        url,
        type: "popup",
        width: 560,
        height: 680
      })
      .then((popupWindow) => {
        session.windowId = popupWindow.id;
      })
      .catch((error) => {
        confirmationSessions.delete(nonce);
        reject(error);
      });
  });
}

function normalizeConfirmationPayload(payload, defaults, lookups) {
  const incoming = payload || {};
  const rawTitle = String(incoming.title ?? "").trim();
  const title = rawTitle || defaults.title || "";

  const correspondent = findByNameOrId(lookups.correspondents, incoming.correspondentName || incoming.correspondentId);
  const documentType = findByNameOrId(lookups.documentTypes, incoming.documentTypeName || incoming.documentTypeId);

  const tagTokens = splitNameList(incoming.tagNames || incoming.tagIds);
  const tagIds = tagTokens.map((token) => {
    const matched = findByNameOrId(lookups.tags, token);
    if (!matched) {
      throw new Error(`Unknown tag: ${token}`);
    }
    return matched.id;
  });

  return {
    title,
    correspondentId: correspondent ? correspondent.id : null,
    documentTypeId: documentType ? documentType.id : null,
    tagIds
  };
}

function toLookupResponse(lookups) {
  return {
    correspondents: lookups.correspondents,
    documentTypes: lookups.documentTypes,
    tags: lookups.tags
  };
}

messenger.runtime.onMessage.addListener(async (message) => {
  if (!message || !message.type) {
    return undefined;
  }

  if (message.type === "paperless.testConnection") {
    try {
      const settings = {
        serverUrl: normalizeBaseUrl(message.serverUrl || ""),
        apiToken: String(message.apiToken || "").trim()
      };
      if (!settings.apiToken) {
        throw new Error("API token is required.");
      }

      await testConnection(settings);
      const lookups = await fetchLookups(settings, true);
      return { ok: true, lookups: toLookupResponse(lookups) };
    } catch (error) {
      return { ok: false, error: error.message || "Connection test failed." };
    }
  }

  if (message.type === "paperless.getConfirmationDefaults") {
    const session = confirmationSessions.get(message.nonce);
    if (!session) {
      return { ok: false, error: "Confirmation session expired." };
    }

    return {
      ok: true,
      defaults: {
        title: session.defaults.title,
        correspondentName: session.defaults.correspondentId
          ? (session.lookups.correspondents.find((c) => c.id === session.defaults.correspondentId) || {}).name || ""
          : "",
        documentTypeName: session.defaults.documentTypeId
          ? (session.lookups.documentTypes.find((d) => d.id === session.defaults.documentTypeId) || {}).name || ""
          : "",
        tagNames: tagIdsToNames(session.defaults.tagIds, session.lookups.tags)
      },
      lookups: toLookupResponse(session.lookups)
    };
  }

  if (message.type === "paperless.submitConfirmation") {
    const session = confirmationSessions.get(message.nonce);
    if (!session) {
      return { ok: false, error: "Confirmation session expired." };
    }

    try {
      const metadata = normalizeConfirmationPayload(message.payload, session.defaults, session.lookups);
      confirmationSessions.delete(message.nonce);
      session.resolve(metadata);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Invalid confirmation data." };
    }
  }

  if (message.type === "paperless.cancelConfirmation") {
    const session = confirmationSessions.get(message.nonce);
    if (session) {
      confirmationSessions.delete(message.nonce);
      session.resolve(null);
    }

    return { ok: true };
  }

  return undefined;
});

messenger.windows.onRemoved.addListener((windowId) => {
  for (const [nonce, session] of confirmationSessions.entries()) {
    if (session.windowId === windowId) {
      confirmationSessions.delete(nonce);
      session.resolve(null);
      return;
    }
  }
});

async function runUpload(info, tab) {
  const attachments = info.attachments || [];
  if (attachments.length === 0) {
    await notify("Paperless upload", "No attachments were selected.");
    return;
  }

  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    await notify("Paperless upload", error.message);
    await messenger.runtime.openOptionsPage();
    return;
  }

  const messageId = await inferMessageId(info, tab);
  if (!messageId) {
    await notify("Paperless upload", "Could not determine the source message.");
    return;
  }

  let messageDate = "";
  let messageSubject = "";
  try {
    const message = await messenger.messages.get(messageId);
    messageDate = message && message.date ? message.date : "";
    messageSubject = message && message.subject ? message.subject : "";
  } catch {
    messageDate = "";
    messageSubject = "";
  }

  let lookups = {
    correspondents: [],
    documentTypes: [],
    tags: []
  };
  try {
    lookups = await fetchLookups(settings);
  } catch {
    // Continue with empty lookup sets; numeric IDs still work.
  }

  const isBulkMenu = info.menuItemId === MENU_UPLOAD_ALL;
  let sharedMetadata = null;

  if (settings.confirmBeforeUpload && isBulkMenu) {
    const firstName = attachments[0] && attachments[0].name ? attachments[0].name : "attachment";
    const defaults = {
      title: "",
      correspondentId: settings.defaultCorrespondentId,
      documentTypeId: settings.defaultDocumentTypeId,
      tagIds: settings.defaultTagIds
    };

    sharedMetadata = await requestUploadMetadata(
      defaults,
      `${firstName} (+${Math.max(0, attachments.length - 1)} more)`,
      lookups,
      true
    );

    if (!sharedMetadata) {
      await notify("Paperless upload", "Bulk upload canceled.");
      return;
    }
  }

  let successCount = 0;
  const failures = [];

  for (const attachment of attachments) {
    const attachmentName = attachment.name || "attachment";

    try {
      if (!attachment.partName) {
        throw new Error(`Attachment \"${attachmentName}\" has no partName.`);
      }

      const file = await messenger.messages.getAttachmentFile(messageId, attachment.partName);
      const perAttachmentDefaultTitle = buildDefaultTitle(messageSubject, attachmentName, settings.titlePrefix);

      let metadata;
      if (sharedMetadata) {
        metadata = {
          title: sharedMetadata.title || perAttachmentDefaultTitle,
          correspondentId: sharedMetadata.correspondentId,
          documentTypeId: sharedMetadata.documentTypeId,
          tagIds: sharedMetadata.tagIds
        };
      } else {
        const defaults = {
          title: perAttachmentDefaultTitle,
          correspondentId: settings.defaultCorrespondentId,
          documentTypeId: settings.defaultDocumentTypeId,
          tagIds: settings.defaultTagIds
        };

        metadata = defaults;
        if (settings.confirmBeforeUpload) {
          metadata = await requestUploadMetadata(defaults, attachmentName, lookups, false);
          if (!metadata) {
            failures.push(`${attachmentName}: canceled.`);
            continue;
          }
        }
      }

      await uploadAttachment({
        file,
        originalName: attachment.name,
        messageDate,
        settings,
        metadata
      });
      successCount += 1;
    } catch (error) {
      failures.push(`${attachmentName}: ${error.message}`);
    }
  }

  if (failures.length === 0) {
    await notify("Paperless upload", `Uploaded ${successCount} attachment(s).`);
    return;
  }

  const firstFailure = failures[0];
  await notify(
    "Paperless upload",
    `Uploaded ${successCount}/${attachments.length}. First error: ${firstFailure}`
  );
}

messenger.menus.create({
  id: MENU_UPLOAD_ONE,
  title: "Upload to Paperless-ngx",
  contexts: ["message_attachments"]
});

messenger.menus.create({
  id: MENU_UPLOAD_ALL,
  title: "Upload all attachments to Paperless-ngx",
  contexts: ["all_message_attachments"]
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_UPLOAD_ONE && info.menuItemId !== MENU_UPLOAD_ALL) {
    return;
  }

  await runUpload(info, tab);
});

messenger.runtime.onInstalled.addListener(() => {
  messenger.runtime.openOptionsPage();
});
