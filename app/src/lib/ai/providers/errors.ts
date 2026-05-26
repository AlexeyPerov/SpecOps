export class ChatProviderError extends Error {
  readonly userMessage: string;

  constructor(message: string, userMessage: string = message) {
    super(message);
    this.name = "ChatProviderError";
    this.userMessage = userMessage;
  }
}
