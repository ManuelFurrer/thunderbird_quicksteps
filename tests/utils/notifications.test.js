import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../../src/utils/notifications.js';

describe('notify', () => {
  let elm;

  beforeEach(() => {
    vi.useFakeTimers();
    elm = document.createElement('div');
    elm.classList.add('hidden');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets the message text and reveals the element', () => {
    expect(elm.classList.contains('hidden')).toBe(true);

    notify({ elm, message: 'Saved!', type: 'success' });

    expect(elm.textContent).toBe('Saved!');
    expect(elm.className).toBe('notify-success');
    expect(elm.classList.contains('hidden')).toBe(false);
  });

  it("defaults to type 'info'", () => {
    notify({ elm, message: 'Hi' });

    expect(elm.className).toBe('notify-info');
  });

  it('hides itself again after the given duration', () => {
    notify({ elm, message: 'Bye', duration: 1000 });

    expect(elm.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(999);
    expect(elm.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(elm.classList.contains('hidden')).toBe(true);
  });

  it('defaults the auto-hide duration to 6000ms', () => {
    notify({ elm, message: 'Default duration' });

    vi.advanceTimersByTime(5999);
    expect(elm.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(elm.classList.contains('hidden')).toBe(true);
  });

  it('resets the hide timer when called again before it fires', () => {
    notify({ elm, message: 'First', duration: 1000 });
    vi.advanceTimersByTime(800);
    expect(elm.textContent).toBe('First');

    notify({ elm, message: 'Second', duration: 1000 });
    vi.advanceTimersByTime(800);
    expect(elm.classList.contains('hidden')).toBe(false);
    expect(elm.textContent).toBe('Second');

    vi.advanceTimersByTime(200);
    expect(elm.classList.contains('hidden')).toBe(true);
  });
});
