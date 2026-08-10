/* eslint-disable global-require */
// Helpers for rendering a screen in isolation.
//
// Screens reload their data with useFocusEffect. Rendering them inside a real
// NavigationContainer just to make that fire would make every test slower and
// couple it to navigator internals, so useFocusEffect is treated as useEffect
// and navigation is a plain spy object whose calls we assert on.

import { render, act, screen, fireEvent } from '@testing-library/react-native';
import { ROLES, RoleProvider } from '../src/utils/role';

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb) => React.useEffect(cb, [cb]),
    useNavigation: () => globalThis.__nav,
    useIsFocused: () => true,
  };
});

export function makeNavigation(overrides = {}) {
  return {
    navigate: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    ...overrides,
  };
}

// renderScreen(Screen, { params }) -> { navigation, setRole, ...renderResult }
//
// Screens read the active flow from RoleContext (see src/utils/role.js), and
// logging out is expressed as setRole(null) rather than a navigation call, so
// the provider has to be present for any screen with a logout path.
export function renderScreen(Screen, { params = {}, navigation, role = ROLES.PATIENT } = {}) {
  const nav = navigation || makeNavigation();
  const setRole = jest.fn();
  globalThis.__nav = nav;
  const utils = render(
    <RoleProvider value={{ role, setRole }}>
      <Screen navigation={nav} route={{ params, key: 'k', name: 'S' }} />
    </RoleProvider>
  );
  return { ...utils, navigation: nav, setRole };
}

// Screens load their data through deep promise chains (session -> rows ->
// per-row lookups). Drain the microtask queue deterministically instead of
// racing it with waitFor, which flakes under fake timers.
export async function flush(times = 25) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Mount a screen and wait for its initial load to settle.
export async function showScreen(Screen, opts) {
  const utils = renderScreen(Screen, opts);
  await flush();
  return utils;
}

// Press by text, regex, or an already-queried element, then settle.
export async function press(target) {
  const el =
    typeof target === 'string' || target instanceof RegExp
      ? screen.getByText(target)
      : target;
  await act(async () => {
    fireEvent.press(el);
  });
  await flush();
}

export async function typeInto(placeholder, text) {
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText(placeholder), text);
  });
}
