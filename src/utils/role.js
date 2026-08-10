import React, { createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMyProfile } from './guardianCloud';

// Which flow the app is currently in.
//
// Deliberately modelled as an ACTIVE MODE rather than an account type. Today
// the mode is decided by profiles.is_guardian and the two flows are hard-
// separated: a guardian has no medicines, no alarms and no patient screens.
//
// The planned next step — one login that asks "patient or guardian?" and routes
// accordingly — only changes `resolveRole()` below. Everything downstream
// (route gating, the mode switcher, every screen) already keys off the mode, so
// it does not need to change.

export const ROLES = { PATIENT: 'patient', GUARDIAN: 'guardian' };

const ROLE_KEY = '@pr_active_role';

export function isRole(value) {
  return value === ROLES.PATIENT || value === ROLES.GUARDIAN;
}

// Last known mode for this device — a fast path so a cold start does not have
// to wait on the network before it can render.
export async function getStoredRole() {
  try {
    const raw = await AsyncStorage.getItem(ROLE_KEY);
    return isRole(raw) ? raw : null;
  } catch (e) {
    return null;
  }
}

export async function setStoredRole(role) {
  try {
    if (isRole(role)) await AsyncStorage.setItem(ROLE_KEY, role);
    else await AsyncStorage.removeItem(ROLE_KEY);
  } catch (e) {
    /* best effort */
  }
}

export async function clearStoredRole() {
  await setStoredRole(null);
}

// The authoritative mode for the signed-in account.
//
// Falls back to the stored mode when the profile cannot be fetched (offline),
// so a guardian on a train still lands in the guardian flow.
export async function resolveRole() {
  try {
    const profile = await getMyProfile();
    if (profile) {
      const role = profile.is_guardian ? ROLES.GUARDIAN : ROLES.PATIENT;
      await setStoredRole(role);
      return role;
    }
  } catch (e) {
    /* fall through to the cached value */
  }
  return getStoredRole();
}

// Does this account's type match the flow the user picked at login? Used to
// refuse a mismatched sign-in rather than silently dropping someone into the
// wrong flow.
export function roleMatchesAccount(wantedRole, profile) {
  const accountRole = profile?.is_guardian ? ROLES.GUARDIAN : ROLES.PATIENT;
  return wantedRole === accountRole;
}

const RoleContext = createContext({
  role: null,
  setRole: () => {},
});

export function RoleProvider({ value, children }) {
  return React.createElement(RoleContext.Provider, { value }, children);
}

export function useRole() {
  return useContext(RoleContext);
}
