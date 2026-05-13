const { EventEmitter } = require('events');
const https = require('https');
const { callGraphAPI } = require('../../utils/graph-api');

jest.mock('https');

function mockHttpsResponse(responseBody = '{}', statusCode = 200) {
  const request = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn()
  };
  const state = { request };

  https.request.mockImplementation((url, options, callback) => {
    state.url = url;
    state.options = options;
    request.end.mockImplementation(() => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      callback(response);
      response.emit('data', Buffer.from(responseBody));
      response.emit('end');
    });
    return request;
  });

  return state;
}

describe('callGraphAPI', () => {
  beforeEach(() => {
    https.request.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('encodes OData filters without mutating the provided query params object', async () => {
    const state = mockHttpsResponse(JSON.stringify({ value: [] }));
    const queryParams = {
      $top: 100,
      $filter: "displayName eq 'O''Brien'"
    };

    const response = await callGraphAPI('access-token', 'GET', 'me/mailFolders', null, queryParams);

    expect(response).toEqual({ value: [] });
    expect(queryParams).toEqual({
      $top: 100,
      $filter: "displayName eq 'O''Brien'"
    });

    const url = new URL(state.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.microsoft.com/v1.0/me/mailFolders');
    expect(url.searchParams.get('$top')).toBe('100');
    expect(url.searchParams.get('$filter')).toBe("displayName eq 'O''Brien'");
  });

  test('sends Buffer payloads as raw octet-stream bodies', async () => {
    const state = mockHttpsResponse(JSON.stringify({ id: 'item-id' }));
    const body = Buffer.from('file contents');

    await callGraphAPI('access-token', 'PUT', 'me/drive/root:/file.txt:/content', body);

    expect(state.options.headers['Content-Type']).toBe('application/octet-stream');
    expect(state.request.write).toHaveBeenCalledWith(body);
  });
});
