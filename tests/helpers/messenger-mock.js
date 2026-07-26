import { vi } from 'vitest';

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      !('mock' in source[key])
    ) {
      target[key] = deepMerge(target[key] ? { ...target[key] } : {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export function createMessengerMock(overrides = {}) {
  const storageData = {};

  const base = {
    i18n: {
      getMessage: vi.fn((key, substitutions) => {
        if (!substitutions || substitutions.length === 0) {
          return key;
        }

        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        return `${key}:${subs.join(',')}`;
      })
    },
    storage: {
      local: {
        get: vi.fn((key) => {
          if (typeof key !== 'string') throw new Error('mock only supports string keys');
          return { [key]: storageData[key] };
        }),
        set: vi.fn((obj) => {
          Object.assign(storageData, obj);
        })
      }
    },
    accounts: {
      list: vi.fn(() => [])
    },
    messages: {
      move: vi.fn(() => {}),
      copy: vi.fn(() => {}),
      delete: vi.fn(() => {}),
      archive: vi.fn(() => {}),
      update: vi.fn(() => {})
    },
    messageDisplay: {
      getDisplayedMessages: vi.fn(() => ({ messages: [] }))
    },
    mailTabs: {
      query: vi.fn(() => [])
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(() => undefined),
      openOptionsPage: vi.fn()
    }
  };

  return deepMerge(base, overrides);
}
