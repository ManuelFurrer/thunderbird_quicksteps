import { vi } from 'vitest';

export function createSendMessageRouter(handlers) {
  return vi.fn((message) => {
    const handler = handlers[message.type];
    if (!handler) return undefined;
    return handler(message);
  });
}

export function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
