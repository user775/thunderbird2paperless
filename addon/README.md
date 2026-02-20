# Thunderbird to Paperless-ngx add-on

This add-on adds context-menu actions on email attachments in Thunderbird:

- `Upload to Paperless-ngx` (for selected attachment(s))
- `Upload all attachments to Paperless-ngx`

It uploads each attachment to Paperless-ngx using:

- `POST /api/documents/post_document/`
- `Authorization: Token <api-token>`

## Configure

1. Install the add-on as a temporary add-on in Thunderbird from this folder's `manifest.json`.
2. Open the add-on preferences.
3. Set:
   - Paperless URL (for example, `http://paperless.local:8000`)
   - API token
   - Optional title prefix
4. Click `Test connection` to verify server/token and load lookup names.

## Features

- Auto-title: `<message subject> - <attachment filename>`.
- Name-based metadata selection (with numeric ID fallback):
  - Correspondent
  - Document type
  - Tags
- Optional per-upload confirmation popup with editable metadata.
- Bulk optimization: `Upload all attachments` asks for confirmation once and applies it to all items.
- Message date is sent as `created` when available.

## Notes

- Host permissions are broad (`http://*/*`, `https://*/*`) to support local-network Paperless URLs.
- Metadata lookups come from:
  - `/api/correspondents/`
  - `/api/document_types/`
  - `/api/tags/`
