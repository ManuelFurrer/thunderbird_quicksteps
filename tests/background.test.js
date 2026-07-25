import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessengerMock } from './helpers/messenger-mock.js';

async function loadBackground(messengerOverrides = {}) {
  vi.resetModules();
  const messenger = createMessengerMock(messengerOverrides);
  globalThis.messenger = messenger;
  await import('../src/background.js');
  const listener = messenger.runtime.onMessage.addListener.mock.calls[0][0];
  return { messenger, listener };
}

describe('background', () => {
  afterEach(() => {
    delete globalThis.messenger;
    vi.restoreAllMocks();
  });

  describe('GET_QUICK_STEPS', () => {
    it('seeds and persists three default steps on first access', async () => {
      const { messenger, listener } = await loadBackground();

      const steps = await listener({ type: 'GET_QUICK_STEPS' });

      expect(steps).toHaveLength(3);
      expect(steps[0]).toMatchObject({
        name: 'defaultStep1Name',
        color: '#4CAF50',
        requireConfirmation: false,
        enabled: true,
        actions: [{ type: 'mark_read' }, { type: 'archive' }]
      });
      expect(steps[1].actions).toEqual([{ type: 'delete' }]);
      expect(steps[2].actions).toEqual([{ type: 'flag' }, { type: 'mark_unread' }]);

      const ids = steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids.every((id) => id.startsWith('qs_'))).toBe(true);

      expect(messenger.storage.local.set).toHaveBeenCalledWith({ quicksteps: steps });
    });

    it('returns previously persisted steps instead of regenerating defaults', async () => {
      const existing = [
        { id: 'qs_1', name: 'Custom', color: '#000', enabled: true, actions: [{ type: 'flag' }] }
      ];
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: existing })) } }
      });

      const steps = await listener({ type: 'GET_QUICK_STEPS' });

      expect(steps).toEqual(existing);
    });

    it('filters to only enabled steps when onlyEnabled is true', async () => {
      const existing = [
        { id: '1', name: 'A', enabled: true, actions: [{ type: 'flag' }] },
        { id: '2', name: 'B', enabled: false, actions: [{ type: 'flag' }] },
        { id: '3', name: 'C', actions: [{ type: 'flag' }] }
      ];
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: existing })) } }
      });

      const steps = await listener({ type: 'GET_QUICK_STEPS', onlyEnabled: true });

      expect(steps.map((s) => s.id)).toEqual(['1', '3']);
    });
  });

  describe('SAVE_QUICK_STEPS', () => {
    it('persists the given steps array and reports success', async () => {
      const { messenger, listener } = await loadBackground();
      const steps = [{ id: 'a', name: 'A', actions: [] }];

      const result = await listener({ type: 'SAVE_QUICK_STEPS', steps });

      expect(result).toEqual({ success: true });
      expect(messenger.storage.local.set).toHaveBeenCalledWith({ quicksteps: steps });

      const updatedSteps = await listener({ type: 'GET_QUICK_STEPS' });
      expect(updatedSteps).toBe(steps);
    });
  });

  describe('GET_SETTINGS / SAVE_SETTINGS', () => {
    it('returns default settings when nothing is stored', async () => {
      const { listener } = await loadBackground();

      const settings = await listener({ type: 'GET_SETTINGS' });

      expect(settings).toEqual({ autoClosePopup: false });
    });

    it('merges stored settings over the defaults', async () => {
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ settings: { autoClosePopup: true } })) } }
      });

      const settings = await listener({ type: 'GET_SETTINGS' });

      expect(settings).toEqual({ autoClosePopup: true });
    });

    it('persists settings via SAVE_SETTINGS', async () => {
      const { messenger, listener } = await loadBackground();

      const result = await listener({ type: 'SAVE_SETTINGS', settings: { autoClosePopup: true } });

      expect(result).toEqual({ success: true });
      expect(messenger.storage.local.set).toHaveBeenCalledWith({
        settings: { autoClosePopup: true }
      });
    });
  });

  describe('GET_ALL_FOLDERS', () => {
    it('flattens nested subfolders across accounts and excludes [Gmail]', async () => {
      const accounts = [
        {
          id: 'acct1',
          name: 'Work',
          rootFolder: {
            subFolders: [
              {
                id: 'f1',
                name: 'Inbox',
                path: '/Inbox',
                subFolders: [{ id: 'f1a', name: 'Archive', path: '/Inbox/Archive' }]
              },
              { id: 'f2', name: '[Gmail]', path: 'Gmail', subFolders: [] }
            ]
          }
        },
        {
          id: 'acct2',
          name: 'Personal',
          rootFolder: { subFolders: [{ id: 'f3', name: 'Inbox', path: '/Inbox' }] }
        }
      ];
      const { listener } = await loadBackground({
        accounts: { list: vi.fn(() => accounts) }
      });

      const folders = await listener({ type: 'GET_ALL_FOLDERS' });

      expect(folders).toEqual([
        { accountId: 'acct1', accountName: 'Work', path: '/Inbox', name: 'Inbox', id: 'f1' },
        {
          accountId: 'acct1',
          accountName: 'Work',
          path: '/Inbox/Archive',
          name: 'Archive',
          id: 'f1a'
        },
        { accountId: 'acct2', accountName: 'Personal', path: '/Inbox', name: 'Inbox', id: 'f3' }
      ]);
    });

    it('returns an empty array if messenger.accounts.list throws', async () => {
      const { listener } = await loadBackground({
        accounts: {
          list: vi.fn(() => {
            throw new Error('boom');
          })
        }
      });

      const folders = await listener({ type: 'GET_ALL_FOLDERS' });

      expect(folders).toEqual([]);
    });

    it('handles accounts without any subfolders', async () => {
      const { listener } = await loadBackground({
        accounts: { list: vi.fn(() => [{ id: 'a', name: 'Empty', rootFolder: {} }]) }
      });

      const folders = await listener({ type: 'GET_ALL_FOLDERS' });

      expect(folders).toEqual([]);
    });
  });

  describe('EXECUTE_QUICK_STEP', () => {
    const baseStep = (overrides = {}) => ({
      id: 'step1',
      name: 'My Step',
      enabled: true,
      actions: [{ type: 'mark_read' }],
      ...overrides
    });

    it("fails with errorQuickStepNotFound when the id doesn't match any step", async () => {
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [] })) } }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'missing',
        tabId: 1
      });

      expect(result).toEqual({ success: false, errors: ['errorQuickStepNotFound'] });
    });

    it('fails with errorNoActionsAssigned when the step has no actions', async () => {
      const step = baseStep({ actions: [] });
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'step1',
        tabId: 1
      });

      expect(result).toEqual({ success: false, errors: ['errorNoActionsAssigned'] });
    });

    it('fails with errorNoMessageSelected when nothing is displayed', async () => {
      const step = baseStep();
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [] })) }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'step1',
        tabId: 1
      });

      expect(result).toEqual({ success: false, errors: ['errorNoMessageSelected'] });
    });

    it('runs every action against every displayed message and reports success', async () => {
      const step = baseStep({ actions: [{ type: 'mark_read' }, { type: 'archive' }] });
      const messages = [{ id: 'm1' }, { id: 'm2' }];
      const { messenger, listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages })) }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'step1',
        tabId: 1
      });

      expect(result.success).toBe(true);
      expect(result.anySucceeded).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.messageCount).toBe(2);
      expect(result.results).toEqual([
        { action: 'mark_read', success: true },
        { action: 'archive', success: true }
      ]);

      expect(messenger.messages.update).toHaveBeenCalledWith('m1', { read: true });
      expect(messenger.messages.update).toHaveBeenCalledWith('m2', { read: true });
      expect(messenger.messages.archive).toHaveBeenCalledWith(['m1', 'm2']);
    });

    it('stops at the first failing action and reports partial success', async () => {
      const step = baseStep({
        actions: [{ type: 'mark_read' }, { type: 'move' }, { type: 'archive' }]
      });
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [{ id: 'm1' }] })) }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'step1',
        tabId: 1
      });

      expect(result.success).toBe(false);
      expect(result.anySucceeded).toBe(true);
      expect(result.results).toEqual([
        { action: 'mark_read', success: true },
        { action: 'move', success: false, error: 'errorNoFolderSpecified' }
      ]);
      expect(result.errors).toEqual(['errorNoFolderSpecified']);
    });

    it("moves and copies to the action's folder id when provided", async () => {
      const step = baseStep({
        actions: [
          { type: 'move', folder: { id: 'folder-1' } },
          { type: 'copy', folder: { id: 'folder-2' } }
        ]
      });
      const { messenger, listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [{ id: 'm1' }] })) }
      });

      const result = await listener({
        type: 'EXECUTE_QUICK_STEP',
        quickStepId: 'step1',
        tabId: 1
      });

      expect(result.success).toBe(true);
      expect(messenger.messages.move).toHaveBeenCalledWith(['m1'], 'folder-1');
      expect(messenger.messages.copy).toHaveBeenCalledWith(['m1'], 'folder-2');
    });

    it('permanently deletes when action type is delete_permanent', async () => {
      const step = baseStep({ actions: [{ type: 'delete_permanent' }] });
      const { messenger, listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [{ id: 'm1' }] })) }
      });

      await listener({ type: 'EXECUTE_QUICK_STEP', quickStepId: 'step1', tabId: 1 });

      expect(messenger.messages.delete).toHaveBeenCalledWith(['m1'], { deletePermanently: true });
    });

    it('flags and unflags messages', async () => {
      const step = baseStep({ actions: [{ type: 'flag' }, { type: 'unflag' }] });
      const { messenger, listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [{ id: 'm1' }] })) }
      });

      await listener({ type: 'EXECUTE_QUICK_STEP', quickStepId: 'step1', tabId: 1 });

      expect(messenger.messages.update).toHaveBeenCalledWith('m1', { flagged: true });
      expect(messenger.messages.update).toHaveBeenCalledWith('m1', { flagged: false });
    });

    it('reports an unknown action type as an error', async () => {
      const step = baseStep({ actions: [{ type: 'not_a_real_action' }] });
      const { listener } = await loadBackground({
        storage: { local: { get: vi.fn(() => ({ quicksteps: [step] })) } },
        messageDisplay: { getDisplayedMessages: vi.fn(() => ({ messages: [{ id: 'm1' }] })) }
      });

      const result = await listener({ type: 'EXECUTE_QUICK_STEP', quickStepId: 'step1', tabId: 1 });

      expect(result.errors).toEqual(['errorUnknownActionType']);
    });
  });

  describe('unrecognized message types', () => {
    it('returns undefined instead of throwing', async () => {
      const { listener } = await loadBackground();

      const result = await listener({ type: 'SOMETHING_UNKNOWN' });

      expect(result).toBeUndefined();
    });
  });
});
