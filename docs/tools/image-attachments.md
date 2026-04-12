---
title: Image Attachments
description: How Telegram and Discord image and document attachments are handled
---

# Image Attachments

Both Telegram and Discord support sending images directly to Jarvis. Images are processed by an OpenAI vision model regardless of the active text provider.

---

## How it works

When an image is attached to a message, the bot:

1. Downloads the image(s) as raw bytes
2. Encodes each as base64
3. Routes the request to the designated image model (`IMAGE_MODEL` in `.env`, defaults to `gpt-5.2`)
4. Sends the text message and all images as a multi-part content array
5. Returns the response as normal

### Provider routing

Images always bypass the active text provider (Claude, MiniMax) and go directly to OpenAI. This is because the Claude Agent SDK and MiniMax don't support vision via this integration.

```
Message + images
      ↓
providers/index.ts — images.length > 0?
      ↓ yes
createOpenAiProvider(IMAGE_MODEL)
      ↓
Multi-part content: [text, image1, image2, ...]
```

If Claude is the active provider and an image is attached, a note is added to the prompt: `[N image(s) attached but the Claude Agent SDK can't process images directly...]`. This fallback ensures the text message still gets a response.

---

## Telegram

Handles single images only (Telegram API limitation per message):

- **Photos** — downloaded at highest available resolution, encoded as `image/jpeg`
- **Document images** — supported if the MIME type is an image type; preserves the actual MIME type (e.g. `image/png`)
- If no caption is provided, defaults to `"What's in this image?"`

---

## Discord

Supports **multiple images per message**:

- All image attachments in a single message are downloaded and passed together
- MIME type is read from Discord's `contentType` header
- If no text is provided alongside the images, defaults to `"What's in this image?"` (single) or `"What's in these images?"` (multiple)
- Non-image attachments (text files, code, etc.) are handled separately — see [File Attachments](#file-attachments)

### File attachments (non-image)

Text-based files are inlined into the message content rather than sent as images:

| Extensions handled | Behaviour |
|---|---|
| `.txt`, `.md`, `.json`, `.csv`, `.xml` | Content inlined, prepended to message |
| `.js`, `.ts`, `.py`, `.html`, `.css` | Content inlined |
| `.yaml`, `.yml`, `.toml`, `.log`, `.sh` | Content inlined |
| Any `text/*` MIME type | Content inlined |

Files are truncated at 50,000 bytes with a `[... truncated ...]` marker.

---

## Configuration

| Env var | Description | Default |
|---|---|---|
| `IMAGE_MODEL` | OpenAI model used for vision requests | `gpt-5.2` |

---

## Relevant files

| File | Role |
|---|---|
| `src/providers/types.ts` | `ImageAttachment` interface (`base64`, `mimeType`) |
| `src/providers/index.ts` | Routes image requests to OpenAI |
| `src/providers/openai.ts` | Builds multi-part content array with all images |
| `src/providers/claude.ts` | Fallback note when images can't be processed |
| `src/providers/minimax.ts` | Supports image array in content parts |
| `src/telegram.ts` | Downloads Telegram photos/documents, wraps in `ImageAttachment[]` |
| `src/discord.ts` | Downloads all Discord image attachments, collects into `ImageAttachment[]` |
