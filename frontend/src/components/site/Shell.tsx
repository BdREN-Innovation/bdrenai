import { Footer } from "./Footer";
import { Header } from "./Header";

export function Shell({
  current,
  overlayHeader = false,
  children,
}: {
  current?: string;
  overlayHeader?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <Header current={current} overlay={overlayHeader} />
      <main className={overlayHeader ? "relative" : undefined}>{children}</main>
      <Footer />
    </>
  );
}
