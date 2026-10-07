/**
 * Small router on top of React Navigation, so screens open each other by path as before:
 *   router.push('/regularise?date=2026-10-08'), router.back(), useLocalSearchParams<{ date?: string }>()
 * A path is a stack screen ('/leave') or a tab ('/', '/calendar', '/menu', '/settings'); the query string becomes the
 * screen's params.
 */
import { createNavigationContainerRef, StackActions, useRoute } from '@react-navigation/native';

export { useFocusEffect } from '@react-navigation/native';

export type Href = string;

export const navigationRef = createNavigationContainerRef<any>();

export const TABS: Record<string, string> = { '': 'index', index: 'index', calendar: 'calendar', menu: 'menu', settings: 'settings' };

function parse(href: Href) {
  const [path, query = ''] = href.split('?');
  const params: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return { name: path.replace(/^\/+|\/+$/g, ''), params };
}

export const router = {
  push(href: Href) {
    if (!navigationRef.isReady()) return;
    const { name, params } = parse(href);
    if (name in TABS) navigationRef.navigate('tabs', { screen: TABS[name], params });
    else navigationRef.dispatch(StackActions.push(name, params));
  },
  back() {
    if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
  },
};

/** The query string of the path that opened this screen. */
export function useLocalSearchParams<T extends Record<string, string | undefined>>(): T {
  return (useRoute().params ?? {}) as T;
}
