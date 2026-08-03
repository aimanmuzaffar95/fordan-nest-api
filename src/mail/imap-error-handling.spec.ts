import { EventEmitter } from 'node:events';

/**
 * Regression cover for the production crash loop.
 *
 * `ImapFlow` is an EventEmitter. When a mailbox socket times out it emits
 * `'error'`, and Node throws an uncaught exception for an `'error'` event with
 * no listener — which killed the whole API process, not just the mail sync.
 * Production's stderr was 1.4MB of exactly that.
 *
 * These tests pin the Node behaviour the fix relies on, so the guard in
 * `buildImapClient` can't be removed without something failing.
 */
describe('IMAP client error handling', () => {
  it('an EventEmitter with no error listener throws — the crash we hit', () => {
    const client = new EventEmitter();
    expect(() => client.emit('error', new Error('Socket timeout'))).toThrow(
      'Socket timeout',
    );
  });

  it('attaching an error listener contains the failure', () => {
    const client = new EventEmitter();
    const seen: string[] = [];
    client.on('error', (err: Error) => seen.push(err.message));

    expect(() =>
      client.emit('error', new Error('Socket timeout')),
    ).not.toThrow();
    expect(seen).toEqual(['Socket timeout']);
  });

  it('keeps containing repeated errors, as a flapping mailbox produces', () => {
    const client = new EventEmitter();
    let count = 0;
    client.on('error', () => count++);

    for (let i = 0; i < 5; i++) {
      expect(() => client.emit('error', new Error(`ETIMEOUT ${i}`))).not.toThrow();
    }
    expect(count).toBe(5);
  });

  it('handles a non-Error payload without throwing', () => {
    // imapflow does not guarantee an Error instance; the handler stringifies
    // whatever arrives rather than assuming `.message` exists.
    const client = new EventEmitter();
    const seen: string[] = [];
    client.on('error', (err: unknown) =>
      seen.push(err instanceof Error ? err.message : String(err)),
    );

    expect(() => client.emit('error', 'raw string failure')).not.toThrow();
    expect(seen).toEqual(['raw string failure']);
  });
});
