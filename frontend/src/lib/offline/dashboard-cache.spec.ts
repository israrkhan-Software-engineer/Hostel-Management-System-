import {
  dashboardCacheKey,
  readDashboardCache,
  writeDashboardCache,
  type OfflineDashboard,
} from './dashboard-cache';

const sample: OfflineDashboard = {
  activeResidents: 14,
  occupiedBeds: 12,
  availableBeds: 5,
  pendingAdmissions: 2,
  openComplaints: 3,
  pendingVisitorVisits: 1,
  capturedAt: '2026-10-23T12:00:00.000Z',
};

function createStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

describe('offline dashboard cache', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => { storage = createStorage(); });

  it('partitions cached summaries by user and branch', () => {
    expect(dashboardCacheKey('user-1', 'branch-1')).not.toBe(dashboardCacheKey('user-2', 'branch-1'));
    expect(dashboardCacheKey('user-1', 'branch-1')).not.toBe(dashboardCacheKey('user-1', 'branch-2'));
  });

  it('writes and reads only the validated aggregate dashboard shape', () => {
    const key = dashboardCacheKey('user-1', 'branch-1');
    expect(writeDashboardCache(storage, key, sample)).toBeNull();
    expect(readDashboardCache(storage, key)).toEqual({ value: sample, error: null });
  });

  it('removes invalid cached content instead of serving it', () => {
    const key = dashboardCacheKey('user-1', 'branch-1');
    storage.setItem(key, JSON.stringify({ visitorPhone: '555-0100' }));

    const result = readDashboardCache(storage, key);

    expect(result.value).toBeNull();
    expect(result.error).toContain('invalid');
    expect(storage.getItem(key)).toBeNull();
  });
});
