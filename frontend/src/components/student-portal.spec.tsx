/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import StudentPortal from './student-portal';

const mockApiRequest = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };

jest.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setAccessToken: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const success = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

describe('StudentPortal', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockReplace.mockReset();
    sessionStorage.clear();
  });

  it('does not display stale data when an earlier branch request finishes late', async () => {
    const branchAResponses = Array.from({ length: 5 }, () => deferred<unknown>());
    let branchAIndex = 0;
    mockApiRequest.mockImplementation((path: string) => {
      if (path === '/auth/profile') {
        return success({ id: 'student', email: 'student@example.test', roles: ['Resident'], permissions: [] });
      }
      if (path === '/branches') {
        return success([
          { id: 'branch-a', name: 'Branch A', code: 'A' },
          { id: 'branch-b', name: 'Branch B', code: 'B' },
        ]);
      }
      if (path.startsWith('/branches/branch-a/')) {
        return branchAResponses[branchAIndex++].promise;
      }
      if (path.endsWith('/residents/me')) {
        return success({
          firstName: 'Student B',
          lastName: 'Resident',
          email: 'student@example.test',
          phone: null,
          status: 'ACTIVE',
          cnicMasked: null,
          accountLinked: true,
        });
      }
      if (path.includes('/mess-menus?weekStart=')) return success({ entries: [] });
      if (path.endsWith('/complaints')) return success([]);
      if (path.endsWith('/notices')) return success([]);
      if (path.endsWith('/resident/finance')) return success([]);
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    render(createElement(StudentPortal));
    const branchSelect = await screen.findByLabelText('Hostel branch');
    await waitFor(() => expect(branchAIndex).toBe(5));

    fireEvent.change(branchSelect, { target: { value: 'branch-b' } });
    expect(await screen.findByRole('heading', { name: 'Welcome, Student B' })).toBeTruthy();

    await act(async () => {
      branchAResponses[0].resolve({ ok: true, data: { firstName: 'Student A', lastName: 'Resident', status: 'ACTIVE' } });
      branchAResponses[1].resolve({ ok: true, data: { entries: [] } });
      branchAResponses[2].resolve({ ok: true, data: [] });
      branchAResponses[3].resolve({ ok: true, data: [] });
      branchAResponses[4].resolve({ ok: true, data: [] });
    });

    expect(screen.getByRole('heading', { name: 'Welcome, Student B' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Welcome, Student A' })).toBeNull();
  });

  it('lets a student update basic profile details', async () => {
    const resident = {
      firstName: 'Amina',
      lastName: 'Khan',
      email: 'student@example.test',
      phone: null,
      dateOfBirth: null,
      status: 'ACTIVE',
      cnicMasked: null,
      accountLinked: true,
      room: null,
    };
    mockApiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/auth/profile') {
        return success({ id: 'student', email: 'student@example.test', roles: ['Resident'], permissions: [] });
      }
      if (path === '/branches') return success([{ id: 'branch-1', name: 'Main Branch', code: 'MAIN' }]);
      if (path === '/branches/branch-1/residents/me' && options?.method === 'PATCH') {
        return success({
          firstName: 'Amina',
          lastName: 'Khan',
          phone: '03001234567',
          dateOfBirth: '2999-01-01',
        });
      }
      if (path.endsWith('/residents/me')) return success(resident);
      if (path.includes('/mess-menus?weekStart=')) return success({ entries: [] });
      if (path.endsWith('/complaints')) return success([]);
      if (path.endsWith('/notices')) return success([]);
      if (path.endsWith('/resident/finance')) return success([]);
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    render(createElement(StudentPortal));
    fireEvent.click(await screen.findByRole('button', { name: 'My Profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '03001234567' } });
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('status')).textContent).toContain('Your profile has been updated.');
    expect(mockApiRequest).toHaveBeenCalledWith('/branches/branch-1/residents/me', {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: 'Amina',
        lastName: 'Khan',
        phone: '03001234567',
        dateOfBirth: '2999-01-01',
      }),
    });
    expect(screen.getByText('03001234567')).toBeTruthy();
  });
});
