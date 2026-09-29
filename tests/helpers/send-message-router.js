import { vi } from 'vitest';

export function createSendMessageRouter(handlers) {
  return vi.fn((message) => {
    const handler = handlers[message.type];
    if (!handler) return Promise.resolve(undefined);
    try {
      return Promise.resolve(handler(message));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}

export function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
