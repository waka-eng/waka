import { useEffect, useState } from 'react';

/**
 * A LIVE REGION THAT IS ANNOUNCED (review). A `role="status"` element that
 * arrives already holding its words is, to most screen readers, a region
 * that never changed — so "Recording", mounted at the moment recording
 * began, was not read out at all. This mounts the region EMPTY and puts the
 * words in a beat after it is in the page, which a reader announces.
 * Changes after that (a new sentence) are announced as usual.
 */
export function LiveWord({ text, className = 'sr-only' }: { text: string; className?: string }) {
  const [said, setSaid] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSaid(text), 60);
    return () => window.clearTimeout(timer);
  }, [text]);
  return <span role="status" className={className}>{said}</span>;
}
