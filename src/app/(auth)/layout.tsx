export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(99,102,241,0.10),transparent)]" />
        <div className="absolute top-[30%] -left-[10%] w-[500px] h-[400px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.05),transparent_70%)]" />
      </div>
      <div className="relative z-10 w-full max-w-md px-4">{children}</div>
    </div>
  );
}
