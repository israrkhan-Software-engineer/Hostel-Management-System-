/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginForm from './login-form';
import { apiRequest, setAccessToken } from '@/lib/api/client';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/lib/api/client', () => ({
  apiRequest: jest.fn(),
  setAccessToken: jest.fn(),
}));

const mockedApiRequest = jest.mocked(apiRequest);
const mockedSetAccessToken = jest.mocked(setAccessToken);

describe('LoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lets a student sign in without a Hostel ID field', async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ ok: true, data: { accessToken: 'student-token' } })
      .mockResolvedValueOnce({ ok: true, data: { roles: ['Resident'] } });

    render(<LoginForm audience="student" tenantSlug="sunrise-hostel" />);
    expect(screen.queryByLabelText('Hostel ID')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Student email or phone'), {
      target: { value: 'student@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StudentPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/resident'));
    expect(mockedApiRequest).toHaveBeenNthCalledWith(1, '/auth/login', expect.objectContaining({
      body: JSON.stringify({
        tenantSlug: 'sunrise-hostel',
        login: 'student@example.com',
        password: 'StudentPass123!',
      }),
    }));
    expect(mockedSetAccessToken).toHaveBeenCalledWith('student-token');
  });

  it('rejects staff credentials on the student sign-in form', async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ ok: true, data: { accessToken: 'staff-token' } })
      .mockResolvedValueOnce({ ok: true, data: { roles: ['Owner'] } })
      .mockResolvedValueOnce({ ok: true, data: undefined });

    render(<LoginForm audience="student" tenantSlug="sunrise-hostel" />);
    fireEvent.change(screen.getByLabelText('Student email or phone'), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'StaffPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This account is not a student account. Please use staff sign in.',
    );
    expect(mockedSetAccessToken).toHaveBeenLastCalledWith(null);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
