/**
 * Порт: куда отправляем ответ пользователю.
 * Реализация для Telegram — adapters/telegram/telegramMessenger.
 * Use case'ы не знают про Telegram Bot API, только про этот метод.
 */
export interface Messenger {
  sendMessage(chatId: number, text: string): Promise<void>;
}
