import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessengerMock } from '../helpers/messenger-mock.js';
import { createSendMessageRouter, flushPromises } from '../helpers/send-message-router.js';

const popupHtmlPath = resolve(process.cwd(), 'src/popup/popup.html');
const popupHtml = readFileSync(popupHtmlPath, 'utf-8');
const popupBody = popupHtml.match(/<body>([\s\S]*)<\/body>/)[1];

async function mountPopup({ steps = [], settings, executeResult, onExecute } = {}) {
  document.documentElement.innerHTML = `<body>${popupBody}</body>`;

  const sendMessage = createSendMessageRouter({
    GET_QUICK_STEPS: () => JSON.parse(JSON.stringify(steps)),
    GET_SETTINGS: () => settings ?? { autoClosePopup: false },
    EXECUTE_QUICK_STEP: (message) => {
      onExecute?.(message);
      return executeResult ?? { success: true, anySucceeded: true, messageCount: 1, errors: [] };
    }
  });

  const messenger = createMessengerMock({
    runtime: { sendMessage, openOptionsPage: vi.fn() },
    mailTabs: { query: vi.fn(() => [{ tabId: 42 }]) }
  });
  globalThis.messenger = messenger;

  vi.spyOn(window, 'close').mockImplementation(() => {});

  vi.resetModules();
  await import('../../src/popup/popup.js');
  document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  await flushPromises();

  return { messenger };
}

describe('popup', () => {
  afterEach(() => {
    delete globalThis.messenger;
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders a button per enabled quick step with name and action summary', async () => {
      await mountPopup({
        steps: [
          {
            id: 's1',
            name: 'Archive & Read',
            color: '#4CAF50',
            actions: [{ type: 'mark_read' }, { type: 'archive' }]
          }
        ]
      });

      const container = document.getElementById('steps-container');
      expect(container.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(true);

      const buttons = container.querySelectorAll('.step-btn');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].querySelector('.step-name').textContent).toBe('Archive & Read');
      expect(buttons[0].querySelector('.step-desc').textContent).toContain('→');
    });

    it('shows the empty state when there are no steps', async () => {
      await mountPopup({ steps: [] });

      expect(document.getElementById('empty-state').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('steps-container').classList.contains('hidden')).toBe(true);
    });

    it('shows an error status when loading steps fails', async () => {
      document.documentElement.innerHTML = `<body>${popupBody}</body>`;
      const sendMessage = vi.fn((message) => {
        if (message.type === 'GET_QUICK_STEPS') throw new Error('network down');
        if (message.type === 'GET_SETTINGS') return { autoClosePopup: false };
        return undefined;
      });
      globalThis.messenger = createMessengerMock({ runtime: { sendMessage } });

      vi.resetModules();
      await import('../../src/popup/popup.js');
      document.dispatchEvent(new window.Event('DOMContentLoaded'));
      await flushPromises();

      const statusBar = document.getElementById('status-bar');
      expect(statusBar.classList.contains('hidden')).toBe(false);
      expect(statusBar.className).toContain('notify-error');
    });
  });

  describe('executing', () => {
    it("executes a quick step immediately when it doesn't require confirmation", async () => {
      const onExecute = vi.fn();
      const { messenger } = await mountPopup({
        steps: [{ id: 's1', name: 'Archive', actions: [{ type: 'archive' }] }],
        onExecute,
        executeResult: { success: true, anySucceeded: true, messageCount: 3, errors: [] }
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      expect(onExecute).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EXECUTE_QUICK_STEP', quickStepId: 's1', tabId: 42 })
      );
      const statusBar = document.getElementById('status-bar');
      expect(statusBar.classList.contains('hidden')).toBe(false);
      expect(statusBar.className).toContain('notify-success');
      expect(messenger.runtime.sendMessage).toHaveBeenCalled();
    });

    it('asks for confirmation before executing a step that requires it, and skips execution on cancel', async () => {
      const onExecute = vi.fn();
      await mountPopup({
        steps: [
          { id: 's1', name: 'Delete', requireConfirmation: true, actions: [{ type: 'delete' }] }
        ],
        onExecute
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      const overlay = document.getElementById('confirm-overlay');
      expect(overlay.classList.contains('hidden')).toBe(false);

      document.getElementById('confirm-cancel').click();
      await flushPromises();

      expect(overlay.classList.contains('hidden')).toBe(true);
      expect(onExecute).not.toHaveBeenCalled();
    });

    it('executes the step after confirming', async () => {
      const onExecute = vi.fn();
      await mountPopup({
        steps: [
          { id: 's1', name: 'Delete', requireConfirmation: true, actions: [{ type: 'delete' }] }
        ],
        onExecute
      });

      document.querySelector('.step-btn').click();
      await flushPromises();
      document.getElementById('confirm-run').click();
      await flushPromises();

      expect(onExecute).toHaveBeenCalledTimes(1);
    });

    it('shows a warning status when some but not all actions succeeded', async () => {
      await mountPopup({
        steps: [{ id: 's1', name: 'Step', actions: [{ type: 'archive' }] }],
        executeResult: {
          success: false,
          anySucceeded: true,
          messageCount: 2,
          errors: ['Something failed']
        }
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      const statusBar = document.getElementById('status-bar');
      expect(statusBar.className).toContain('notify-warning');
    });

    it('shows an error status when execution fully fails', async () => {
      await mountPopup({
        steps: [{ id: 's1', name: 'Step', actions: [{ type: 'archive' }] }],
        executeResult: {
          success: false,
          anySucceeded: false,
          messageCount: 0,
          errors: ['No message selected']
        }
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      const statusBar = document.getElementById('status-bar');
      expect(statusBar.className).toContain('notify-error');
    });

    it('closes the popup after a successful run when autoClosePopup is enabled', async () => {
      await mountPopup({
        steps: [{ id: 's1', name: 'Step', actions: [{ type: 'archive' }] }],
        settings: { autoClosePopup: true },
        executeResult: { success: true, anySucceeded: true, messageCount: 1, errors: [] }
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      expect(window.close).toHaveBeenCalled();
    });

    it('does not close the popup after a run when autoClosePopup is disabled', async () => {
      await mountPopup({
        steps: [{ id: 's1', name: 'Step', actions: [{ type: 'archive' }] }],
        settings: { autoClosePopup: false },
        executeResult: { success: true, anySucceeded: true, messageCount: 1, errors: [] }
      });

      document.querySelector('.step-btn').click();
      await flushPromises();

      expect(window.close).not.toHaveBeenCalled();
    });

    it('opens the options page and closes the popup when clicking the settings button', async () => {
      const { messenger } = await mountPopup({ steps: [] });

      document.getElementById('btn-settings').click();

      expect(messenger.runtime.openOptionsPage).toHaveBeenCalled();
      expect(window.close).toHaveBeenCalled();
    });

    it("opens the options page from the empty state's 'create first' button", async () => {
      const { messenger } = await mountPopup({ steps: [] });

      document.getElementById('createFirstBtn').click();

      expect(messenger.runtime.openOptionsPage).toHaveBeenCalled();
    });
  });
});
