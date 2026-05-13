const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getInboxRules, handleListRules } = require('../../rules/list');
const handleCreateRule = require('../../rules/create');
const { handleEditRuleSequence, rulesTools } = require('../../rules');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../rules/list', () => ({
  handleListRules: jest.fn(),
  getInboxRules: jest.fn()
}));
jest.mock('../../rules/create', () => jest.fn());

describe('rules module registry', () => {
  test('exports registered rules tools with handlers', () => {
    const toolsByName = new Map(rulesTools.map(tool => [tool.name, tool]));

    expect([...toolsByName.keys()]).toEqual([
      'list-rules',
      'create-rule',
      'edit-rule-sequence'
    ]);
    expect(toolsByName.get('list-rules').handler).toBe(handleListRules);
    expect(toolsByName.get('create-rule').handler).toBe(handleCreateRule);
    expect(toolsByName.get('edit-rule-sequence').handler).toBe(handleEditRuleSequence);
  });
});

describe('handleEditRuleSequence', () => {
  const mockAccessToken = 'dummy_access_token';

  beforeEach(() => {
    callGraphAPI.mockClear();
    ensureAuthenticated.mockClear();
    getInboxRules.mockClear();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
  });

  test('updates the sequence for an existing rule', async () => {
    getInboxRules.mockResolvedValue([
      { id: 'rule-id', displayName: 'Archive promos', sequence: 100 }
    ]);
    callGraphAPI.mockResolvedValue({});

    const result = await handleEditRuleSequence({
      ruleName: 'Archive promos',
      sequence: 5
    });

    expect(ensureAuthenticated).toHaveBeenCalledTimes(1);
    expect(getInboxRules).toHaveBeenCalledWith(mockAccessToken);
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/mailFolders/inbox/messageRules/rule-id',
      { sequence: 5 }
    );
    expect(result.content[0].text).toBe('Successfully updated the sequence of rule "Archive promos" to 5.');
  });

  test('does not patch when the rule is missing', async () => {
    getInboxRules.mockResolvedValue([
      { id: 'other-rule-id', displayName: 'Other rule', sequence: 1 }
    ]);

    const result = await handleEditRuleSequence({
      ruleName: 'Archive promos',
      sequence: 5
    });

    expect(result.content[0].text).toBe('Rule with name "Archive promos" not found.');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});
