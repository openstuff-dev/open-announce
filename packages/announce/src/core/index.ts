// Safe to import anywhere, including Node: nothing here touches the DOM when it loads.
export * from './types.js';
export * from './rules.js';
export * from './config.js';
export { FeedClient, clientFor } from './client.js';
export { MessageMarks } from './dismissals.js';
export type { MessageActions, RenderMessage } from './element.js';
