import { useLayoutEffect, useRef } from 'react';

/** Keep sticky captions below the rendered player or audience phone header. */
export function usePhoneHeaderOffset() {
  const captions = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = captions.current;
    const page = element?.closest<HTMLElement>('.phone-page');
    const header = page?.querySelector<HTMLElement>('.phone-header');
    if (!element || !header || !page) return;
    const measure = () => {
      const headerHeight = Math.ceil(header.getBoundingClientRect().height);
      element.style.setProperty('--phone-header-height', `${headerHeight}px`);
      // Action shortcuts must land below both sticky surfaces, even while captions wrap.
      const stickyHeight = headerHeight + 8 + Math.ceil(element.getBoundingClientRect().height) + 12;
      page.style.setProperty('--phone-sticky-height', `${stickyHeight}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(header, { box: 'border-box' });
    observer?.observe(element, { box: 'border-box' });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      element.style.removeProperty('--phone-header-height');
      page.style.removeProperty('--phone-sticky-height');
    };
  }, []);
  return captions;
}
