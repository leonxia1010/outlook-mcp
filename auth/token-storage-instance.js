const TokenStorage = require('./token-storage');

// Shared singleton: the tool-call path and check-auth-status must use the same
// in-memory token cache and refresh lock, otherwise concurrent refreshes can
// each fire their own grant request to Microsoft.
module.exports = new TokenStorage();
