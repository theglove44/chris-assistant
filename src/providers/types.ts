export interface Provider {
  name: string;
  chat(chatId: number, userMessage: string): Promise<string>;
}
