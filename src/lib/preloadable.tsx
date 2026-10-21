import { lazy, type ComponentType } from 'react';

/**
 * A code-split component that can be fetched ahead of time. Once preloaded it
 * renders directly: `React.lazy` alone suspends on first render even for a
 * cached chunk, and React holds a revealed fallback for ~300 ms.
 */
export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
) {
  let loaded: ComponentType<P> | undefined;
  const preload = () =>
    load().then((component) => {
      loaded = component;
      return component;
    });
  const Lazy = lazy(() =>
    preload().then((component) => ({ default: component })),
  );
  function Preloadable(props: P) {
    const Component = loaded ?? Lazy;
    return <Component {...props} />;
  }
  return [Preloadable, preload] as const;
}
