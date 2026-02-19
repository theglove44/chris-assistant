export interface Provider {
  name: string;
  chat(chatId: number, userMessage: string, onChunk?: (accumulated: string) => void): Promise<string>;
}
