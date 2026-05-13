const {
  calendarTools,
  handleAcceptEvent,
  handleCancelEvent,
  handleCreateEvent,
  handleDeclineEvent,
  handleDeleteEvent,
  handleListEvents
} = require('../../calendar');

describe('calendar tool registry', () => {
  test('exports every documented calendar tool with its handler', () => {
    const toolsByName = new Map(calendarTools.map(tool => [tool.name, tool]));

    expect([...toolsByName.keys()]).toEqual([
      'list-events',
      'accept-event',
      'decline-event',
      'create-event',
      'cancel-event',
      'delete-event'
    ]);

    expect(toolsByName.get('list-events').handler).toBe(handleListEvents);
    expect(toolsByName.get('accept-event').handler).toBe(handleAcceptEvent);
    expect(toolsByName.get('decline-event').handler).toBe(handleDeclineEvent);
    expect(toolsByName.get('create-event').handler).toBe(handleCreateEvent);
    expect(toolsByName.get('cancel-event').handler).toBe(handleCancelEvent);
    expect(toolsByName.get('delete-event').handler).toBe(handleDeleteEvent);
  });
});
