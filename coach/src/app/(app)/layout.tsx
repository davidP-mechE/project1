import { AppBar } from "@/components/app-bar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppBar />
      {children}
    </>
  );
}
