const handleListFolders = require('../../folder/list');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

describe('handleListFolders (deep walk)', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    ensureAuthenticated.mockClear();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  // 3-level mailbox tree:
  //   Inbox (childFolderCount: 1)
  //     └── Projects (childFolderCount: 1)
  //           └── HelloCity (childFolderCount: 0)
  function mockThreeLevelTree() {
    // L0: top-level — Inbox has 1 child
    callGraphAPI.mockResolvedValueOnce({
      value: [
        { id: 'inbox-id', displayName: 'Inbox', parentFolderId: null, childFolderCount: 1 }
      ]
    });
    // L1: Inbox's children — Projects has 1 child
    callGraphAPI.mockResolvedValueOnce({
      value: [
        { id: 'projects-id', displayName: 'Projects', parentFolderId: 'inbox-id', childFolderCount: 1 }
      ]
    });
    // L2: Projects's children — HelloCity is a leaf
    callGraphAPI.mockResolvedValueOnce({
      value: [
        { id: 'hellocity-id', displayName: 'HelloCity', parentFolderId: 'projects-id', childFolderCount: 0 }
      ]
    });
  }

  test('hierarchy output shows folders at 3 levels with increasing indent', async () => {
    mockThreeLevelTree();

    const result = await handleListFolders({ includeChildren: true });

    const text = result.content[0].text;
    expect(text).toContain('Inbox');
    expect(text).toContain('Projects');
    expect(text).toContain('HelloCity');

    // Each level is indented two more spaces than its parent.
    const lines = text.split('\n');
    const inboxLine = lines.find(l => l.trim() === 'Inbox');
    const projectsLine = lines.find(l => l.trim() === 'Projects');
    const helloCityLine = lines.find(l => l.trim() === 'HelloCity');

    const indent = l => l.length - l.trimStart().length;
    expect(indent(projectsLine)).toBe(indent(inboxLine) + 2);
    expect(indent(helloCityLine)).toBe(indent(projectsLine) + 2);
  });

  test('BFS stops descending once childFolderCount is 0 at every leaf', async () => {
    mockThreeLevelTree();

    await handleListFolders({ includeChildren: true });

    // Exactly 3 API calls: root + 1 expansion per level with children. No call for HelloCity.
    expect(callGraphAPI).toHaveBeenCalledTimes(3);
    expect(callGraphAPI).toHaveBeenNthCalledWith(
      1,
      mockAccessToken,
      'GET',
      'me/mailFolders',
      null,
      expect.objectContaining({ $top: 100 })
    );
    expect(callGraphAPI).toHaveBeenNthCalledWith(
      2,
      mockAccessToken,
      'GET',
      'me/mailFolders/inbox-id/childFolders',
      null,
      expect.any(Object)
    );
    expect(callGraphAPI).toHaveBeenNthCalledWith(
      3,
      mockAccessToken,
      'GET',
      'me/mailFolders/projects-id/childFolders',
      null,
      expect.any(Object)
    );
  });

  test('flat list output names every level with parent annotation for nested folders', async () => {
    mockThreeLevelTree();

    const result = await handleListFolders({});  // includeChildren false → flat list

    const text = result.content[0].text;
    expect(text).toContain('Inbox');
    expect(text).toContain('Projects (in Inbox)');
    expect(text).toContain('HelloCity (in Projects)');
  });

  test('handles authentication error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListFolders({});

    expect(result.content[0].text).toContain('Authentication required');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});
