export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <p className="text-center font-data text-sm font-semibold tracking-widest">
          DEALRADAR
        </p>
        {children}
      </div>
    </main>
  );
}
