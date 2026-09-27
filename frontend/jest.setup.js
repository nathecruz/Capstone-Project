const React = require('react');
const nodeFetch = globalThis.__HABITAI_ORIGINAL_FETCH__;

if (typeof React.act !== 'function') {
  const { act } = require('react-dom/test-utils');
  if (typeof act === 'function') {
    React.act = act;
  }
}

if (typeof nodeFetch === 'function') {
  globalThis.fetch = nodeFetch;
}

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
