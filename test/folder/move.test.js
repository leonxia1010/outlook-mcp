const handleMoveEmails = require('../../folder/move');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getFolderIdByName } = require('../../email/folder-utils');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

describe('handleMoveEmails', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    ensureAuthenticated.mockClear();
    getFolderIdByName.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('moves emails to a nested target folder', async () => {
    const leafId = 'hellocity-id';
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    getFolderIdByName.mockResolvedValue(leafId);
    callGraphAPI.mockResolvedValue({});

    const result = await handleMoveEmails({
      emailIds: 'email-1,email-2',
      targetFolder: 'Inbox/Projects/HelloCity'
    });

    expect(getFolderIdByName).toHaveBeenCalledWith(
      mockAccessToken,
      'Inbox/Projects/HelloCity'
    );
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/email-1/move',
      { destinationId: leafId }
    );
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/email-2/move',
      { destinationId: leafId }
    );
    expect(result.content[0].text).toContain('Successfully moved 2 email(s) to "Inbox/Projects/HelloCity"');
  });

  test('surfaces path-syntax hint when target folder is missing', async () => {
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    getFolderIdByName.mockResolvedValue(null);

    const result = await handleMoveEmails({
      emailIds: 'email-1',
      targetFolder: 'Inbox/Missing'
    });

    expect(result.content[0].text).toContain('Target folder "Inbox/Missing" not found');
    expect(result.content[0].text).toContain("'Parent/Child' syntax");
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('ignores legacy sourceFolder argument from stale clients', async () => {
    const leafId = 'archive-id';
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    getFolderIdByName.mockResolvedValue(leafId);
    callGraphAPI.mockResolvedValue({});

    const result = await handleMoveEmails({
      emailIds: 'email-1',
      targetFolder: 'Archive',
      sourceFolder: 'Inbox'  // legacy field — handler must not error
    });

    expect(result.content[0].text).toContain('Successfully moved 1 email(s) to "Archive"');
    // getFolderIdByName called only for the target — never for the dropped sourceFolder
    expect(getFolderIdByName).toHaveBeenCalledTimes(1);
    expect(getFolderIdByName).toHaveBeenCalledWith(mockAccessToken, 'Archive');
  });

  test('rejects when emailIds is empty', async () => {
    const result = await handleMoveEmails({
      emailIds: '',
      targetFolder: 'Inbox/Sub'
    });

    expect(result.content[0].text).toContain('Email IDs are required');
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  test('rejects when targetFolder is empty', async () => {
    const result = await handleMoveEmails({
      emailIds: 'email-1',
      targetFolder: ''
    });

    expect(result.content[0].text).toContain('Target folder name is required');
    expect(ensureAuthenticated).not.toHaveBeenCalled();
  });

  test('reports per-email errors but counts successful moves', async () => {
    const leafId = 'archive-id';
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    getFolderIdByName.mockResolvedValue(leafId);
    callGraphAPI
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Item not found'));

    const result = await handleMoveEmails({
      emailIds: 'good-id,bad-id',
      targetFolder: 'Archive'
    });

    expect(result.content[0].text).toContain('Successfully moved 1 email(s)');
    expect(result.content[0].text).toContain('Failed to move 1 email(s)');
    expect(result.content[0].text).toContain('Item not found');
  });
});
