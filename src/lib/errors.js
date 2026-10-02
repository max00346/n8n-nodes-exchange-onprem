'use strict';
class ExchangeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExchangeError';
    this.code = code;
    this.details = details;
  }
}
function fail(message) {
  throw new ExchangeError('INPUT', message);
}
function safeError(error) {
  return error instanceof ExchangeError
    ? `${error.code}: ${error.message}`
    : 'Exchange request failed. Check configuration and server logs. Before repeating a write, check its outcome in Exchange.';
}
function nodeError(node, error, itemIndex) {
  const message = safeError(error);
  // n8n supplies this optional peer. Do not install a second SDK with the node package.
  try {
    const { NodeOperationError } = require('n8n-workflow');
    return new NodeOperationError(node, message, itemIndex === undefined ? {} : { itemIndex });
  } catch {
    const result = new Error(message);
    result.name = 'ExchangeNodeError';
    result.context = { nodeName: node.name, itemIndex };
    return result;
  }
}
module.exports = { ExchangeError, fail, safeError, nodeError };
