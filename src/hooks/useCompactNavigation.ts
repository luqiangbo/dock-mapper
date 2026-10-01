import { useEffect, useState } from "react";
export function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 799px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 799px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
