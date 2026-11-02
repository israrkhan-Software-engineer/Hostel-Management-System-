export type OfflineDashboard = {
  activeResidents: number;
  occupiedBeds: number;
  availableBeds: number;
  pendingAdmissions: number;
  openComplaints: number;
  pendingVisitorVisits: number;
  capturedAt: string;
};

export type DashboardCacheRead = {
  value: OfflineDashboard | null;
  error: string | null;
};

export function dashboardCacheKey(userId: string, branchId: string) {
  return `hms-offline-dashboard:${userId}:${branchId}`;
}

function isOfflineDashboard(value: unknown): value is OfflineDashboard {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const counts = [
    'activeResidents',
    'occupiedBeds',
    'availableBeds',
    'pendingAdmissions',
    'openComplaints',
    'pendingVisitorVisits',
  ];
  return counts.every((key) => Number.isSafeInteger(data[key]) && Number(data[key]) >= 0)
    && typeof data.capturedAt === 'string'
    && Number.isFinite(Date.parse(data.capturedAt));
}

type DashboardStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export function readDashboardCache(storage: DashboardStorage, key: string): DashboardCacheRead {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { value: null, error: null };
    const value: unknown = JSON.parse(raw);
    if (isOfflineDashboard(value)) return { value, error: null };
    storage.removeItem(key);
    return { value: null, error: 'The saved offline dashboard was invalid and has been removed.' };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? `Could not read the offline dashboard: ${error.message}` : 'Could not read the offline dashboard.',
    };
  }
}

export function writeDashboardCache(storage: DashboardStorage, key: string, value: OfflineDashboard): string | null {
  try {
    storage.setItem(key, JSON.stringify(value));
    return null;
  } catch (error) {
    return error instanceof Error
      ? `Could not save the offline dashboard: ${error.message}`
      : 'Could not save the offline dashboard.';
  }
}
