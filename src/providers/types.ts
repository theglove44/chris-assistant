export interface ImageAttachment {
  /** Base64-encoded image data (no data: prefix) */
  base64: string;
  /** MIME type, e.g. "image/jpeg" */
  mimeType: string;
}

export interface Provider {
  name: string;
  chat(
    chatId: number,
    userMessage: string,
    onChunk?: (accumulated: string) => void,
    image?: ImageAttachment,
  ): Promise<string>;
}
