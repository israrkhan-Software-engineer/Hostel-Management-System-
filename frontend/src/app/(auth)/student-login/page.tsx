import LoginForm from '@/components/login-form';

type StudentLoginPageProps = {
  searchParams: Promise<{ hostel?: string | string[] }>;
};

export default async function StudentLoginPage({ searchParams }: StudentLoginPageProps) {
  const { hostel } = await searchParams;
  const hostelSlug = typeof hostel === 'string'
    ? hostel.trim()
    : '';
  return <LoginForm audience="student" tenantSlug={hostelSlug} />;
}
