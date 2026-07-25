import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessengerMock } from '../helpers/messenger-mock.js';
import { createSendMessageRouter, flushPromises } from '../helpers/send-message-router.js';

const optionsHtmlPath = resolve(process.cwd(), 'src/options/options.html');
const optionsHtml = readFileSync(optionsHtmlPath, 'utf-8');
const optionsBody = optionsHtml.match(/<body>([\s\S]*)<\/body>/)[1];

const FOLDERS = [
  { accountId: 'a1', accountName: 'Work', id: 'f1', name: 'Inbox', path: '/Inbox' },
  { accountId: 'a1', accountName: 'Work', id: 'f2', name: 'Archive', path: '/Archive' }
];

async function mountOptions({
  steps = [],
  settings,
  folders = FOLDERS,
  routerOverrides = {}
} = {}) {
  document.documentElement.innerHTML = `<body>${optionsBody}</body>`;

  let currentSteps = steps;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const sendMessage = createSendMessageRouter({
    GET_QUICK_STEPS: () => clone(currentSteps),
    GET_SETTINGS: () => clone(settings ?? { autoClosePopup: false }),
    GET_ALL_FOLDERS: () => clone(folders),
    SAVE_QUICK_STEPS: (message) => {
      currentSteps = clone(message.steps);
      return { success: true };
    },
    SAVE_SETTINGS: () => ({ success: true }),
    ...routerOverrides
  });

  const messenger = createMessengerMock({ runtime: { sendMessage } });
  globalThis.messenger = messenger;

  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  vi.resetModules();
  await import('../../src/options/options.js');
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await flushPromises();

  return { messenger, getSteps: () => currentSteps };
}

function setInputFiles(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
}

describe('options page', () => {
  afterEach(() => {
    delete globalThis.messenger;
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders existing steps in the sidebar and shows the placeholder initially', async () => {
      await mountOptions({
        steps: [
          {
            id: 's1',
            name: 'Archive',
            color: '#4CAF50',
            enabled: true,
            actions: [{ type: 'archive' }]
          },
          {
            id: 's2',
            name: 'Trash',
            color: '#f44336',
            enabled: false,
            actions: [{ type: 'delete' }]
          }
        ]
      });

      const items = document.querySelectorAll('.step-item');
      expect(items).toHaveLength(2);
      expect(items[0].querySelector('.step-item-name').textContent).toBe('Archive');
      expect(items[1].classList.contains('step-item-disabled')).toBe(true);

      expect(document.getElementById('editor-placeholder').classList.contains('hidden')).toBe(
        false
      );
      expect(document.getElementById('editor').classList.contains('hidden')).toBe(true);
    });

    it('shows the sidebar empty state when there are no steps', async () => {
      await mountOptions({ steps: [] });

      expect(document.getElementById('sidebar-empty').classList.contains('hidden')).toBe(false);
    });
  });

  describe('sidebar actions', () => {
    it('clicking a sidebar step opens it in the editor with its values', async () => {
      await mountOptions({
        steps: [
          {
            id: 's1',
            name: 'Archive',
            color: '#4CAF50',
            enabled: true,
            requireConfirmation: true,
            actions: [{ type: 'archive' }]
          }
        ]
      });

      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      expect(document.getElementById('editor').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('step-name').value).toBe('Archive');
      expect(document.getElementById('step-require-confirmation').checked).toBe(true);
      expect(document.getElementById('step-enabled').checked).toBe(true);
    });

    it('creates a new blank step and focuses the name field on new step click', async () => {
      await mountOptions({ steps: [] });

      document.getElementById('btn-new-step').click();
      await flushPromises();

      expect(document.getElementById('editor').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('step-name').value).toBe('');
      expect(document.querySelectorAll('.step-item')).toHaveLength(1);
    });

    it('refuses to save a step without a name', async () => {
      await mountOptions({ steps: [] });
      document.getElementById('btn-new-step').click();
      await flushPromises();

      document.getElementById('btn-save').click();
      await flushPromises();

      const toast = document.getElementById('toast');
      expect(toast.className).toContain('notify-error');
    });

    it('refuses to save a move action with no destination folder selected', async () => {
      await mountOptions({ steps: [] });
      document.getElementById('btn-new-step').click();
      await flushPromises();
      document.getElementById('step-name').value = 'My Step';
      document.getElementById('step-name').dispatchEvent(new window.Event('input'));

      document.querySelector('.action-type-select').value = 'move';
      document.querySelector('.action-type-select').dispatchEvent(new window.Event('change'));
      await flushPromises();

      document.getElementById('btn-save').click();
      await flushPromises();

      expect(document.getElementById('toast').className).toContain('notify-error');
    });

    it('persists a valid step and reflects it in the sidebar', async () => {
      const { getSteps, messenger } = await mountOptions({ steps: [] });
      document.getElementById('btn-new-step').click();
      await flushPromises();

      document.getElementById('step-name').value = 'My New Step';
      document.getElementById('step-name').dispatchEvent(new window.Event('input'));

      document.getElementById('btn-save').click();
      await flushPromises();

      expect(document.getElementById('toast').className).toContain('notify-success');
      expect(getSteps()).toHaveLength(1);
      expect(getSteps()[0].name).toBe('My New Step');
      expect(messenger.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SAVE_QUICK_STEPS' })
      );

      const sidebarName = document.querySelector('.step-item-name');
      expect(sidebarName.textContent).toBe('My New Step');
    });
  });

  describe('quickstep settings', () => {
    it('adds, removes and reorders actions with the up/down/remove buttons', async () => {
      await mountOptions({
        steps: [{ id: 's1', name: 'Step', enabled: true, actions: [{ type: 'mark_read' }] }]
      });
      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      document.getElementById('btn-add-action').click();

      const rows = () => document.querySelectorAll('.action-row');

      expect(rows()).toHaveLength(2);

      rows()[1].querySelector('.action-btn:not(.remove)').click();
      expect(rows()).toHaveLength(2);

      rows()[0].querySelector('.action-btn.remove').click();
      expect(document.querySelectorAll('.action-row')).toHaveLength(1);
    });

    it("toggling enabled updates the sidebar item's disabled styling immediately", async () => {
      await mountOptions({
        steps: [{ id: 's1', name: 'Step', enabled: true, actions: [{ type: 'mark_read' }] }]
      });
      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      const checkbox = document.getElementById('step-enabled');
      checkbox.checked = false;
      checkbox.dispatchEvent(new window.Event('change'));

      expect(
        document.querySelector('.step-item[data-id="s1"]').classList.contains('step-item-disabled')
      ).toBe(true);
    });

    it('updates the color swatch and sidebar name color when picking a color', async () => {
      await mountOptions({
        steps: [
          {
            id: 's1',
            name: 'Step',
            color: '#0078D4',
            enabled: true,
            actions: [{ type: 'mark_read' }]
          }
        ]
      });
      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      const colorInput = document.getElementById('step-color');
      colorInput.value = '#ff0000';
      colorInput.dispatchEvent(new window.Event('input'));

      expect(document.getElementById('color-swatch').style.backgroundColor).toBe('rgb(255, 0, 0)');
      expect(document.querySelector('.step-item-name').style.color).toBe('rgb(255, 0, 0)');
    });

    it('asks for confirmation before deleting a step, and removes it once confirmed', async () => {
      const { getSteps } = await mountOptions({
        steps: [{ id: 's1', name: 'DeleteMe', enabled: true, actions: [{ type: 'mark_read' }] }]
      });
      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      document.getElementById('btn-delete-step').click();
      expect(document.getElementById('confirm-overlay').classList.contains('hidden')).toBe(false);

      document.getElementById('confirm-cancel').click();
      expect(getSteps()).toHaveLength(1);

      document.getElementById('btn-delete-step').click();
      document.getElementById('confirm-ok').click();
      await flushPromises();

      expect(getSteps()).toHaveLength(0);
      expect(document.getElementById('editor').classList.contains('hidden')).toBe(true);
    });

    it('autosaves the current step when navigating to another one', async () => {
      const { getSteps } = await mountOptions({
        steps: [
          { id: 's1', name: 'First', enabled: true, actions: [{ type: 'mark_read' }] },
          { id: 's2', name: 'Second', enabled: true, actions: [{ type: 'mark_read' }] }
        ]
      });
      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      document.getElementById('step-name').value = 'First (edited)';
      document.getElementById('step-name').dispatchEvent(new window.Event('input'));

      document.querySelector('.step-item[data-id="s2"]').click();
      await flushPromises();

      expect(getSteps().find((s) => s.id === 's1').name).toBe('First (edited)');
    });

    it('discards a brand new, untouched step when navigating away without saving', async () => {
      const { getSteps } = await mountOptions({
        steps: [{ id: 's1', name: 'First', enabled: true, actions: [{ type: 'mark_read' }] }]
      });

      document.getElementById('btn-new-step').click();
      await flushPromises();
      expect(document.querySelectorAll('.step-item')).toHaveLength(2);

      document.querySelector('.step-item[data-id="s1"]').click();
      await flushPromises();

      expect(document.querySelectorAll('.step-item')).toHaveLength(1);
      expect(getSteps()).toHaveLength(1);
      expect(getSteps()[0].id).toBe('s1');
    });
  });

  describe('settings', () => {
    it('switches to the settings view and toggles auto-close popup', async () => {
      await mountOptions();

      document.getElementById('btn-nav-settings').click();
      await flushPromises();

      expect(document.getElementById('settings-view').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('editor-footer').classList.contains('hidden')).toBe(true);
    });

    it('toggles auto-close popup', async () => {
      const { messenger } = await mountOptions({ steps: [], settings: { autoClosePopup: false } });

      document.getElementById('btn-nav-settings').click();
      await flushPromises();

      const checkbox = document.getElementById('setting-auto-close-popup');
      expect(checkbox.checked).toBe(false);
      checkbox.checked = true;
      checkbox.dispatchEvent(new window.Event('change'));
      await flushPromises();

      expect(messenger.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SAVE_SETTINGS',
        settings: { autoClosePopup: true }
      });
    });

    it('exports steps as a downloadable JSON file', async () => {
      await mountOptions({
        steps: [{ id: 's1', name: 'Step', enabled: true, actions: [{ type: 'mark_read' }] }]
      });

      document.getElementById('btn-nav-settings').click();
      await flushPromises();
      document.getElementById('btn-export-steps').click();

      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.HTMLAnchorElement.prototype.click).toHaveBeenCalled();
      expect(document.getElementById('toast').className).toContain('notify-success');
    });

    it('imports steps from a file, merging with existing steps after confirmation', async () => {
      const { getSteps } = await mountOptions({
        steps: [{ id: 's1', name: 'Existing', enabled: true, actions: [{ type: 'mark_read' }] }]
      });

      document.getElementById('btn-nav-settings').click();
      await flushPromises();

      const importedRaw = [
        { name: 'Imported One', actions: [{ type: 'archive' }] },
        { name: 'Imported Two', actions: [{ type: 'flag' }] }
      ];
      const file = new window.File([JSON.stringify(importedRaw)], 'export.json', {
        type: 'application/json'
      });
      const input = document.getElementById('import-file-input');
      setInputFiles(input, file);
      input.dispatchEvent(new window.Event('change'));
      await flushPromises();

      expect(document.getElementById('import-overlay').classList.contains('hidden')).toBe(false);

      document.getElementById('import-merge').click();
      await flushPromises();

      expect(getSteps()).toHaveLength(3);
      expect(document.getElementById('toast').className).toContain('notify-success');
    });

    it("rejects a file that isn't a valid quick steps export", async () => {
      await mountOptions({ steps: [] });
      document.getElementById('btn-nav-settings').click();
      await flushPromises();

      const file = new window.File(['not json'], 'bad.json', { type: 'application/json' });
      const input = document.getElementById('import-file-input');
      setInputFiles(input, file);
      input.dispatchEvent(new window.Event('change'));
      await flushPromises();

      expect(document.getElementById('toast').className).toContain('notify-error');
    });
  });
});
