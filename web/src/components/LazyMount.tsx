import { useEffect, useRef, useState, type ReactNode } from "react";

// Mounts its children only once they scroll near the viewport, so a review
// with hundreds of files (or a 20k-line change) doesn't build every diff up
// front — off-screen content stays a cheap placeholder until you reach it.
export function LazyMount({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown]);

  return <div ref={ref}>{shown ? children : <div className="diff-placeholder" style={{ minHeight }} />}</div>;
}
