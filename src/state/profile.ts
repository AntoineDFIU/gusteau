import { useCallback, useState } from 'react';
import type { Profile } from '../types';

// The profile lives in this browser only (localStorage). Storage can be
// unavailable (private windows, blocked site data), so every access is
// guarded and the app works without it.

const KEY = 'gusteau.profile.v1';
const CUISINE_DEFAULTS_VERSION = 1;

export const NEW_PROFILE: Profile = {
  onboarded: false,
  favoriteCuisines: ['american', 'italian', 'mexican', 'chinese', 'french'],
  favoriteRecipes: [],
  hardExclusions: [],
  allergies: [],
  equipment: ['stovetop', 'oven', 'microwave'],
  history: [],
};

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return NEW_PROFILE;
    // Older profiles also kept a kitchen inventory; that's no longer used, so it's dropped.
    const { pantry: _pantry, pantryBasics: _basics, cuisineDefaultsVersion, ...saved } = JSON.parse(raw) as Partial<Profile> & { pantry?: unknown; pantryBasics?: unknown; cuisineDefaultsVersion?: number };
    const profile = { ...NEW_PROFILE, ...saved };
    // Older browsers may have saved an empty list before defaults existed.
    // Migrate once so choosing no favorites afterward still remains a valid choice.
    if (cuisineDefaultsVersion !== CUISINE_DEFAULTS_VERSION) {
      if (!profile.favoriteCuisines?.length) profile.favoriteCuisines = [...NEW_PROFILE.favoriteCuisines];
      save(profile);
    }
    return profile;
  } catch {
    return NEW_PROFILE;
  }
}

function save(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, cuisineDefaultsVersion: CUISINE_DEFAULTS_VERSION }));
  } catch {
    /* storage unavailable: keep going in memory */
  }
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile>(load);
  const update = useCallback((patch: Partial<Profile> | ((p: Profile) => Partial<Profile>)) => {
    setProfile((p) => {
      const next = { ...p, ...(typeof patch === 'function' ? patch(p) : patch) };
      save(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    save(NEW_PROFILE);
    setProfile(NEW_PROFILE);
  }, []);
  return { profile, update, reset };
}
