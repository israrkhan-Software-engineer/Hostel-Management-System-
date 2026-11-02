import LoginForm from '@/components/login-form';

type StudentLoginPageProps = {
  searchParams: { hostel?: string | string[] };
};

export default function StudentLoginPage({ searchParams }: StudentLoginPageProps) {
  const hostelSlug = typeof searchParams.hostel === 'string'
    ? searchParams.hostel.trim()
    : '';
  return <LoginForm audience="student" tenantSlug={hostelSlug || 'sunrise-hostel'} />;
}
