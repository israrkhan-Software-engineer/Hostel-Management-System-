import { apiDownload, apiRequest, apiUpload, setAccessToken, getAccessToken } from './client';

describe('API client', () => {
  beforeEach(() => {
    setAccessToken(null);
    global.fetch = jest.fn();
  });

  it('getAccessToken returns null initially', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('setAccessToken / getAccessToken round-trip', () => {
    setAccessToken('test-token');
    expect(getAccessToken()).toBe('test-token');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });

  it('sends Authorization header when token is set', async () => {
    setAccessToken('bearer-abc');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    await apiRequest('/health');
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].headers['Authorization']).toBe('Bearer bearer-abc');
  });

  it('does not send Authorization header when no token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await apiRequest('/health');
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].headers['Authorization']).toBeUndefined();
  });

  it('refreshes once after a 401 and retries with the new access token', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ message: 'Expired' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: 'rotated-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 'ok' }) });

    const result = await apiRequest<{ value: string }>('/secure');

    expect(result).toEqual({ ok: true, data: { value: 'ok' } });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect((global.fetch as jest.Mock).mock.calls[2][1].headers['Authorization']).toBe('Bearer rotated-token');
  });

  it('does not use tenant refresh for platform administrator requests', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Platform session expired' }),
    });

    const result = await apiRequest('/platform/admin/dashboard');

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false with status on non-200', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ message: 'No permission' }),
    });
    const result = await apiRequest('/residents');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toBe('No permission');
    }
  });

  it('returns ok:false on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    const result = await apiRequest('/residents');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(0);
  });

  it('uploads multipart files without a JSON content type', async () => {
    const formData = new FormData();
    formData.set('amountMinor', '120000');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'PENDING' }),
    });

    const result = await apiUpload('/proofs', formData);

    expect(result).toEqual({ ok: true, data: { status: 'PENDING' } });
    const options = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(options.body).toBe(formData);
    expect(options.headers['Content-Type']).toBeUndefined();
  });

  it('downloads a protected PDF blob', async () => {
    const pdf = new Blob(['%PDF-test'], { type: 'application/pdf' });
    setAccessToken('download-token');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      blob: async () => pdf,
    });

    const result = await apiDownload('/branches/branch-1/invoices/invoice-1/pdf');

    expect(result).toEqual({ ok: true, data: pdf });
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer download-token');
  });
});
