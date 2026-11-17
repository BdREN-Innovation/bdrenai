import { Footer } from "./Footer";
import { Header } from "./Header";

export function Shell({ current, children }: { current?: string; children: React.ReactNode }) {
  return (
    <>
      <Header current={current} />
      <main>{children}</main>
      <Footer />
    </>
  );
}
