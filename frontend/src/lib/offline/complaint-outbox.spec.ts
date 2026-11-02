import {
  addQueuedComplaint,
  complaintOutboxKey,
  readComplaintOutbox,
  removeQueuedComplaint,
  writeComplaintOutbox,
  type QueuedComplaint,
} from './complaint-outbox';

const complaint: QueuedComplaint = {
  clientMutationId: '4c89d50b-5aa9-4b74-99ec-3b52d2179e0a',
  title: 'Water leak',
  description: 'The shower is leaking.',
  priority: 'NORMAL',
  queuedAt: '2026-10-23T12:00:00.000Z',
};

function createStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

describe('offline complaint outbox', () => {
  it('partitions queued complaints by user and branch', () => {
    expect(complaintOutboxKey('user-1', 'branch-1'))
      .not.toBe(complaintOutboxKey('user-2', 'branch-1'));
    expect(complaintOutboxKey('user-1', 'branch-1'))
      .not.toBe(complaintOutboxKey('user-1', 'branch-2'));
  });

  it('persists and removes a queued complaint', () => {
    const storage = createStorage();
    const key = complaintOutboxKey('user-1', 'branch-1');
    expect(addQueuedComplaint(storage, key, complaint)).toEqual({
      items: [complaint],
      error: null,
    });
    expect(readComplaintOutbox(storage, key)).toEqual({ items: [complaint], error: null });
    expect(removeQueuedComplaint(storage, key, complaint.clientMutationId))
      .toEqual({ items: [], error: null });
  });

  it('removes malformed saved data rather than replaying it', () => {
    const storage = createStorage();
    const key = complaintOutboxKey('user-1', 'branch-1');
    storage.setItem(key, JSON.stringify([{ ...complaint, clientMutationId: 'not-a-uuid' }]));

    expect(readComplaintOutbox(storage, key)).toEqual({
      items: [],
      error: 'The saved offline complaints were invalid and have been removed.',
    });
    expect(storage.getItem(key)).toBeNull();
  });

  it('rejects invalid items before writing', () => {
    const storage = createStorage();
    expect(writeComplaintOutbox(storage, 'key', [{ ...complaint, description: '' }]))
      .toBe('The offline complaint queue is invalid or full.');
    expect(storage.getItem('key')).toBeNull();
  });
});
