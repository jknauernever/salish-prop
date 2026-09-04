import { useEffect, useState } from 'react';

/** Phone-sized viewports: below Tailwind's `sm` breakpoint. */
export const MOBILE_QUERY = '(max-width: 639px)';

export function isMobileNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

/** True on phone-sized viewports; updates live on resize / rotation. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(isMobileNow);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}
