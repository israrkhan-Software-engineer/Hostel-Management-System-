export type QueuedComplaint = {
  clientMutationId: string;
  title: string;
  description: string;
  priority: 'NORMAL';
  queuedAt: string;
  syncError?: string;
};

export type ComplaintOutboxRead = {
  items: QueuedComplaint[];
  error: string | null;
};

type OutboxStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const MAX_QUEUED_COMPLAINTS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function complaintOutboxKey(userId: string, branchId: string) {
  return `hms-offline-complaints:${userId}:${branchId}`;
}

function isQueuedComplaint(value: unknown): value is QueuedComplaint {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.clientMutationId === 'string'
    && UUID_PATTERN.test(item.clientMutationId)
    && typeof item.title === 'string'
    && item.title.length > 0
    && item.title.length <= 150
    && typeof item.description === 'string'
    && item.description.length > 0
    && item.description.length <= 4000
    && item.priority === 'NORMAL'
    && typeof item.queuedAt === 'string'
    && Number.isFinite(Date.parse(item.queuedAt))
    && (item.syncError === undefined || typeof item.syncError === 'string');
}

export function readComplaintOutbox(storage: OutboxStorage, key: string): ComplaintOutboxRead {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { items: [], error: null };
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value)
      || value.length > MAX_QUEUED_COMPLAINTS
      || !value.every(isQueuedComplaint)
    ) {
      storage.removeItem(key);
      return { items: [], error: 'The saved offline complaints were invalid and have been removed.' };
    }
    return { items: value, error: null };
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error
        ? `Could not read queued complaints: ${error.message}`
        : 'Could not read queued complaints.',
    };
  }
}

export function writeComplaintOutbox(
  storage: OutboxStorage,
  key: string,
  items: QueuedComplaint[],
): string | null {
  if (items.length > MAX_QUEUED_COMPLAINTS || !items.every(isQueuedComplaint)) {
    return 'The offline complaint queue is invalid or full.';
  }
  try {
    storage.setItem(key, JSON.stringify(items));
    return null;
  } catch (error) {
    return error instanceof Error
      ? `Could not save queued complaints: ${error.message}`
      : 'Could not save queued complaints.';
  }
}

export function addQueuedComplaint(
  storage: OutboxStorage,
  key: string,
  complaint: QueuedComplaint,
): ComplaintOutboxRead {
  const current = readComplaintOutbox(storage, key);
  if (current.error) return current;
  if (current.items.length >= MAX_QUEUED_COMPLAINTS) {
    return { items: current.items, error: 'The offline complaint queue is full. Reconnect and sync before adding another.' };
  }
  const items = [...current.items, complaint];
  const error = writeComplaintOutbox(storage, key, items);
  return { items: error ? current.items : items, error };
}

export function removeQueuedComplaint(
  storage: OutboxStorage,
  key: string,
  clientMutationId: string,
): ComplaintOutboxRead {
  const current = readComplaintOutbox(storage, key);
  if (current.error) return current;
  const items = current.items.filter((item) => item.clientMutationId !== clientMutationId);
  const error = writeComplaintOutbox(storage, key, items);
  return { items: error ? current.items : items, error };
}

export function markQueuedComplaintFailed(
  storage: OutboxStorage,
  key: string,
  clientMutationId: string,
  syncError: string,
): ComplaintOutboxRead {
  const current = readComplaintOutbox(storage, key);
  if (current.error) return current;
  const items = current.items.map((item) => (
    item.clientMutationId === clientMutationId ? { ...item, syncError } : item
  ));
  const error = writeComplaintOutbox(storage, key, items);
  return { items: error ? current.items : items, error };
}
