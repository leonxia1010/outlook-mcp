const {
  WELL_KNOWN_FOLDERS,
  WELL_KNOWN_FOLDER_IDS,
  escapeODataLiteral,
  normalizeFolderSegments,
  resolveFolderPath,
  getFolderIdByName
} = require('../../email/folder-utils');
const { callGraphAPI } = require('../../utils/graph-api');

jest.mock('../../utils/graph-api');

describe('escapeODataLiteral', () => {
  test("doubles single quotes (' → '')", () => {
    expect(escapeODataLiteral("O'Brien")).toBe("O''Brien");
    expect(escapeODataLiteral("a'b'c")).toBe("a''b''c");
  });

  test('leaves strings without single quotes unchanged', () => {
    expect(escapeODataLiteral('Inbox')).toBe('Inbox');
    expect(escapeODataLiteral('')).toBe('');
  });

  test('coerces non-string input', () => {
    expect(escapeODataLiteral(42)).toBe('42');
  });
});

describe('normalizeFolderSegments', () => {
  test('splits and trims', () => {
    expect(normalizeFolderSegments('A/B/C')).toEqual(['A', 'B', 'C']);
    expect(normalizeFolderSegments(' Inbox / Sub ')).toEqual(['Inbox', 'Sub']);
  });

  test('drops empty segments from leading/trailing/double slashes', () => {
    expect(normalizeFolderSegments('/Inbox/')).toEqual(['Inbox']);
    expect(normalizeFolderSegments('Inbox//Sub')).toEqual(['Inbox', 'Sub']);
    expect(normalizeFolderSegments('//')).toEqual([]);
  });

  test('handles null/undefined/empty as no segments', () => {
    expect(normalizeFolderSegments(null)).toEqual([]);
    expect(normalizeFolderSegments(undefined)).toEqual([]);
    expect(normalizeFolderSegments('')).toEqual([]);
  });
});

describe('resolveFolderPath', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('well-known folders (no API calls)', () => {
    test.each([
      [null, WELL_KNOWN_FOLDERS['inbox']],
      [undefined, WELL_KNOWN_FOLDERS['inbox']],
      ['', WELL_KNOWN_FOLDERS['inbox']],
      ['inbox', WELL_KNOWN_FOLDERS['inbox']],
      ['INBOX', WELL_KNOWN_FOLDERS['inbox']],
      ['Drafts', WELL_KNOWN_FOLDERS['drafts']],
      ['sent', WELL_KNOWN_FOLDERS['sent']],
      ['ARCHIVE', WELL_KNOWN_FOLDERS['archive']]
    ])('%p resolves without API calls', async (input, expected) => {
      const result = await resolveFolderPath(mockAccessToken, input);
      expect(result).toBe(expected);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });

    test('whitespace-only normalizes to inbox', async () => {
      const result = await resolveFolderPath(mockAccessToken, '   ');
      expect(result).toBe(WELL_KNOWN_FOLDERS['inbox']);
      expect(callGraphAPI).not.toHaveBeenCalled();
    });
  });

  describe('custom single-segment folders', () => {
    test('resolves custom folder by id on exact match', async () => {
      const customFolderId = 'custom-folder-id-123';
      const customFolderName = 'MyCustomFolder';

      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: customFolderId, displayName: customFolderName }]
      });

      const result = await resolveFolderPath(mockAccessToken, customFolderName);

      expect(result).toBe(`me/mailFolders/${customFolderId}/messages`);
      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/mailFolders',
        null,
        { $filter: `displayName eq '${customFolderName}'` }
      );
    });

    test('falls back to case-insensitive scan when exact match fails', async () => {
      const customFolderId = 'custom-folder-id-456';
      callGraphAPI.mockResolvedValueOnce({ value: [] });
      callGraphAPI.mockResolvedValueOnce({
        value: [
          { id: 'other-id', displayName: 'OtherFolder' },
          { id: customFolderId, displayName: 'projectalpha' }
        ]
      });

      const result = await resolveFolderPath(mockAccessToken, 'ProjectAlpha');

      expect(result).toBe(`me/mailFolders/${customFolderId}/messages`);
      expect(callGraphAPI).toHaveBeenCalledTimes(2);
    });

    test('returns null (no silent inbox fallback) when folder is not found', async () => {
      callGraphAPI.mockResolvedValueOnce({ value: [] });
      callGraphAPI.mockResolvedValueOnce({
        value: [
          { id: 'id1', displayName: 'Folder1' },
          { id: 'id2', displayName: 'Folder2' }
        ]
      });

      const result = await resolveFolderPath(mockAccessToken, 'NonExistentFolder');

      expect(result).toBeNull();
      expect(callGraphAPI).toHaveBeenCalledTimes(2);
    });

    test('returns null when API call rejects', async () => {
      callGraphAPI.mockRejectedValueOnce(new Error('API Error'));

      const result = await resolveFolderPath(mockAccessToken, 'CustomFolder');

      expect(result).toBeNull();
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
    });

    test('escapes single quotes in displayName for OData $filter', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'obrien-id', displayName: "O'Brien" }]
      });

      await resolveFolderPath(mockAccessToken, "O'Brien");

      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/mailFolders',
        null,
        { $filter: "displayName eq 'O''Brien'" }
      );
    });
  });

  describe('nested path syntax', () => {
    test('resolves Inbox/Projects/HelloCity via two childFolders lookups', async () => {
      const projectsId = 'projects-id';
      const helloCityId = 'hellocity-id';

      // Look up "Projects" under inbox (well-known id 'inbox')
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: projectsId, displayName: 'Projects' }]
      });
      // Look up "HelloCity" under projectsId
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: helloCityId, displayName: 'HelloCity' }]
      });

      const result = await resolveFolderPath(mockAccessToken, 'Inbox/Projects/HelloCity');

      expect(result).toBe(`me/mailFolders/${helloCityId}/messages`);
      expect(callGraphAPI).toHaveBeenNthCalledWith(
        1,
        mockAccessToken,
        'GET',
        'me/mailFolders/inbox/childFolders',
        null,
        { $filter: "displayName eq 'Projects'" }
      );
      expect(callGraphAPI).toHaveBeenNthCalledWith(
        2,
        mockAccessToken,
        'GET',
        `me/mailFolders/${projectsId}/childFolders`,
        null,
        { $filter: "displayName eq 'HelloCity'" }
      );
    });

    test('first segment well-known is case-insensitive', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'sub-id', displayName: 'Sub' }]
      });

      const result = await resolveFolderPath(mockAccessToken, 'inbox/Sub');

      expect(result).toBe('me/mailFolders/sub-id/messages');
      // First call uses well-known 'inbox' id without an API lookup for the first segment
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/mailFolders/inbox/childFolders',
        null,
        { $filter: "displayName eq 'Sub'" }
      );
    });

    test('returns null when a mid-path segment is missing', async () => {
      // Look up "DoesNotExist" under inbox: exact miss, then fallback empty
      callGraphAPI.mockResolvedValueOnce({ value: [] });
      callGraphAPI.mockResolvedValueOnce({ value: [] });

      const result = await resolveFolderPath(mockAccessToken, 'Inbox/DoesNotExist/Whatever');

      expect(result).toBeNull();
      // Should stop after the missing segment — no lookup for "Whatever"
      expect(callGraphAPI).toHaveBeenCalledTimes(2);
    });

    test('normalises leading/trailing/double slashes', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'sub-id', displayName: 'Sub' }]
      });

      const result = await resolveFolderPath(mockAccessToken, '/Inbox//Sub/');

      expect(result).toBe('me/mailFolders/sub-id/messages');
      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/mailFolders/inbox/childFolders',
        null,
        { $filter: "displayName eq 'Sub'" }
      );
    });

    test('first segment non-well-known resolves via root lookup then childFolders', async () => {
      const topId = 'custom-top-id';
      const subId = 'sub-id';

      // Root lookup for "CustomTop"
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: topId, displayName: 'CustomTop' }]
      });
      // childFolders of CustomTop, looking for "Sub"
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: subId, displayName: 'Sub' }]
      });

      const result = await resolveFolderPath(mockAccessToken, 'CustomTop/Sub');

      expect(result).toBe(`me/mailFolders/${subId}/messages`);
      expect(callGraphAPI).toHaveBeenNthCalledWith(
        1,
        mockAccessToken,
        'GET',
        'me/mailFolders',
        null,
        { $filter: "displayName eq 'CustomTop'" }
      );
      expect(callGraphAPI).toHaveBeenNthCalledWith(
        2,
        mockAccessToken,
        'GET',
        `me/mailFolders/${topId}/childFolders`,
        null,
        { $filter: "displayName eq 'Sub'" }
      );
    });

    test('escapes single quotes per-segment in nested path', async () => {
      callGraphAPI.mockResolvedValueOnce({
        value: [{ id: 'obrien-id', displayName: "O'Brien" }]
      });

      await resolveFolderPath(mockAccessToken, "Inbox/O'Brien");

      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/mailFolders/inbox/childFolders',
        null,
        { $filter: "displayName eq 'O''Brien'" }
      );
    });
  });
});

describe('getFolderIdByName', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('returns folder id on exact root match', async () => {
    const folderId = 'folder-id-123';
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: folderId, displayName: 'TestFolder' }]
    });

    const result = await getFolderIdByName(mockAccessToken, 'TestFolder');

    expect(result).toBe(folderId);
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/mailFolders',
      null,
      { $filter: "displayName eq 'TestFolder'" }
    );
  });

  test('returns folder id on case-insensitive root match', async () => {
    const folderId = 'folder-id-456';
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: folderId, displayName: 'testfolder' }]
    });

    const result = await getFolderIdByName(mockAccessToken, 'TestFolder');

    expect(result).toBe(folderId);
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
  });

  test('returns null when folder is not found', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: 'id1', displayName: 'OtherFolder' }]
    });

    const result = await getFolderIdByName(mockAccessToken, 'NonExistent');

    expect(result).toBeNull();
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
  });

  test('returns null when API rejects', async () => {
    callGraphAPI.mockRejectedValueOnce(new Error('API Error'));

    const result = await getFolderIdByName(mockAccessToken, 'TestFolder');

    expect(result).toBeNull();
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  test('resolves nested path to leaf id', async () => {
    const projectsId = 'projects-id';
    const archiveId = 'archive-id';

    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: projectsId, displayName: 'Projects' }]
    });
    callGraphAPI.mockResolvedValueOnce({
      value: [{ id: archiveId, displayName: 'Archive' }]
    });

    const result = await getFolderIdByName(mockAccessToken, 'Inbox/Projects/Archive');

    expect(result).toBe(archiveId);
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
  });

  test('returns null when nested path has a missing segment', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    const result = await getFolderIdByName(mockAccessToken, 'Inbox/Missing');

    expect(result).toBeNull();
  });

  test('WELL_KNOWN_FOLDER_IDS sibling map is populated for first-segment lookups', () => {
    expect(WELL_KNOWN_FOLDER_IDS.inbox).toBe('inbox');
    expect(WELL_KNOWN_FOLDER_IDS.sent).toBe('sentItems');
    expect(WELL_KNOWN_FOLDER_IDS.deleted).toBe('deletedItems');
    expect(WELL_KNOWN_FOLDER_IDS.junk).toBe('junkemail');
  });
});
