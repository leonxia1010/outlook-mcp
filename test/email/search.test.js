const handleSearchEmails = require('../../email/search');
const { callGraphAPIPaginated } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { resolveFolderPath } = require('../../email/folder-utils');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

describe('handleSearchEmails', () => {
  const mockAccessToken = 'dummy_access_token';
  const endpoint = 'me/mailFolders/inbox/messages';
  const matchingEmail = {
    id: 'email-1',
    subject: 'Search hit',
    from: {
      emailAddress: {
        name: 'Sender',
        address: 'sender@example.com'
      }
    },
    receivedDateTime: '2024-01-15T10:30:00Z',
    isRead: true
  };

  beforeEach(() => {
    callGraphAPIPaginated.mockClear();
    ensureAuthenticated.mockClear();
    resolveFolderPath.mockClear();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    resolveFolderPath.mockResolvedValue(endpoint);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('escapes general query text before embedding it in Graph KQL search', async () => {
    callGraphAPIPaginated.mockResolvedValue({ value: [matchingEmail] });

    const result = await handleSearchEmails({
      query: 'hello " OR from:boss@example.com',
      count: 10
    });

    expect(callGraphAPIPaginated).toHaveBeenCalledTimes(1);
    const [, method, calledEndpoint, params, maxCount] = callGraphAPIPaginated.mock.calls[0];
    expect(method).toBe('GET');
    expect(calledEndpoint).toBe(endpoint);
    expect(maxCount).toBe(10);
    expect(params.$search).toBe('"hello \\" OR from:boss@example.com"');
    expect(params).not.toHaveProperty('$orderby');
    expect(result.content[0].text).toContain('Found 1 emails matching your search criteria');
  });

  test('surfaces path-syntax hint when the target folder cannot be resolved', async () => {
    resolveFolderPath.mockResolvedValue(null);

    const result = await handleSearchEmails({
      folder: 'Inbox/Missing',
      query: 'invoice'
    });

    expect(result.content[0].text).toContain('Folder "Inbox/Missing" not found');
    expect(result.content[0].text).toContain("'Parent/Child' syntax");
    expect(callGraphAPIPaginated).not.toHaveBeenCalled();
  });
});
