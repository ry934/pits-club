import { MouseEvent, ReactNode, useEffect, useState } from 'react';

/** Routeur minimal sur le hash : #/pilote/Paul -> ['pilote', 'Paul']. */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/');

export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: (e: MouseEvent) => void }) {
  return <a href={to} className={className} onClick={onClick}>{children}</a>;
}
