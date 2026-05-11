const handleCreateRule = require('../../rules/create');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getFolderIdByName } = require('../../email/folder-utils');

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
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
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
});
