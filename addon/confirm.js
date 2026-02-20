const params = new URLSearchParams(window.location.search);
const nonce = params.get("nonce") || "";
const attachmentName = params.get("attachment") || "attachment";
const bulkMode = params.get("bulk") === "1";

const attachmentNameEl = document.getElementById("attachment-name");
const form = document.getElementById("confirm-form");
const titleInput = document.getElementById("title");
const correspondentNameInput = document.getElementById("correspondent-name");
const documentTypeNameInput = document.getElementById("document-type-name");
const tagNamesInput = document.getElementById("tag-names");
const correspondentsList = document.getElementById("correspondents-list");
const documentTypesList = document.getElementById("document-types-list");
const statusEl = document.getElementById("status");
const cancelButton = document.getElementById("cancel");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a4000f" : "#0a6700";
}

function fillDatalist(listEl, items) {
  listEl.textContent = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.name;
    listEl.appendChild(option);
  }
}

async function loadDefaults() {
  attachmentNameEl.textContent = bulkMode
    ? `Bulk upload set: ${attachmentName}`
    : `Attachment: ${attachmentName}`;

  if (!nonce) {
    throw new Error("Missing confirmation nonce.");
  }

  const response = await messenger.runtime.sendMessage({
    type: "paperless.getConfirmationDefaults",
    nonce
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Failed to load defaults.");
  }

  titleInput.value = response.defaults.title || "";
  correspondentNameInput.value = response.defaults.correspondentName || "";
  documentTypeNameInput.value = response.defaults.documentTypeName || "";
  tagNamesInput.value = response.defaults.tagNames || "";

  fillDatalist(correspondentsList, response.lookups.correspondents || []);
  fillDatalist(documentTypesList, response.lookups.documentTypes || []);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await messenger.runtime.sendMessage({
    type: "paperless.submitConfirmation",
    nonce,
    payload: {
      title: titleInput.value,
      correspondentName: correspondentNameInput.value,
      documentTypeName: documentTypeNameInput.value,
      tagNames: tagNamesInput.value
    }
  });

  if (!response || !response.ok) {
    setStatus((response && response.error) || "Failed to submit.", true);
    return;
  }

  window.close();
});

cancelButton.addEventListener("click", async () => {
  await messenger.runtime.sendMessage({
    type: "paperless.cancelConfirmation",
    nonce
  });
  window.close();
});

loadDefaults().catch((error) => {
  setStatus(error.message || "Failed to initialize dialog.", true);
});
