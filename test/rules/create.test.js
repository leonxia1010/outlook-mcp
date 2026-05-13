const handleCreateRule = require('../../rules/create');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getFolderIdByName } = require('../../email/folder-utils');
const { getInboxRules } = require('../../rules/list');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');
jest.mock('../../rules/list', () => ({ getInboxRules: jest.fn() }));

describe('handleCreateRule (nested moveToFolder)', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    ensureAuthenticated.mockClear();
    getFolderIdByName.mockClear();
    getInboxRules.mockClear();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    getInboxRules.mockResolvedValue([]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('creates a rule whose moveToFolder action uses the leaf id of a nested path', async () => {
    const leafId = 'archive-id';
    getFolderIdByName.mockResolvedValue(leafId);
    callGraphAPI.mockResolvedValue({ id: 'rule-id' });

    const result = await handleCreateRule({
      name: 'Archive promos',
      fromAddresses: 'promo@example.com',
      moveToFolder: 'Inbox/Projects/Archive'
    });

    expect(getFolderIdByName).toHaveBeenCalledWith(
      mockAccessToken,
      'Inbox/Projects/Archive'
    );

    // The Graph POST should carry actions.moveToFolder = leafId
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/mailFolders/inbox/messageRules',
      expect.objectContaining({
        actions: expect.objectContaining({ moveToFolder: leafId })
      })
    );
    expect(result.content[0].text).toContain('Successfully created rule "Archive promos"');
  });

  test('surfaces path-syntax hint when moveToFolder cannot be resolved', async () => {
    getFolderIdByName.mockResolvedValue(null);

    const result = await handleCreateRule({
      name: 'Bad rule',
      fromAddresses: 'noise@example.com',
      moveToFolder: 'Inbox/Missing'
    });

    expect(result.content[0].text).toContain('Target folder "Inbox/Missing" not found');
    expect(result.content[0].text).toContain("'Parent/Child' syntax");

    // No rule creation call should be made if the destination is unresolved
    const ruleCreationCalls = callGraphAPI.mock.calls.filter(
      ([, method, endpoint]) =>
        method === 'POST' && endpoint === 'me/mailFolders/inbox/messageRules'
    );
    expect(ruleCreationCalls).toHaveLength(0);
  });

  test('rejects rules without a condition before authenticating', async () => {
    const result = await handleCreateRule({
      name: 'No condition',
      markAsRead: true
    });

    expect(result.content[0].text).toBe('At least one condition is required. Specify fromAddresses, containsSubject, or hasAttachments.');
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('rejects rules without an action before authenticating', async () => {
    const result = await handleCreateRule({
      name: 'No action',
      containsSubject: 'Invoice'
    });

    expect(result.content[0].text).toBe('At least one action is required. Specify moveToFolder or markAsRead.');
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('creates a mark-as-read rule without resolving a folder', async () => {
    callGraphAPI.mockResolvedValue({ id: 'rule-id' });

    const result = await handleCreateRule({
      name: 'Read invoices',
      containsSubject: 'Invoice',
      markAsRead: true,
      sequence: 7
    });

    expect(getFolderIdByName).not.toHaveBeenCalled();
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/mailFolders/inbox/messageRules',
      expect.objectContaining({
        displayName: 'Read invoices',
        sequence: 7,
        conditions: { subjectContains: ['Invoice'] },
        actions: { markAsRead: true }
      })
    );
    expect(result.content[0].text).toContain('Successfully created rule "Read invoices" with sequence 7.');
  });

  test('auto-generates sequence after the highest existing sequence', async () => {
    getInboxRules.mockResolvedValue([
      { sequence: 99 },
      { sequence: 120 }
    ]);
    callGraphAPI.mockResolvedValue({ id: 'rule-id' });

    await handleCreateRule({
      name: 'Auto sequence',
      fromAddresses: 'sender@example.com',
      markAsRead: true
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/mailFolders/inbox/messageRules',
      expect.objectContaining({ sequence: 121 })
    );
  });
});
