import { useCallback, useState } from 'react';
import type { Profile } from '../types';

// The profile lives in this browser only (localStorage). Storage can be
// unavailable (private windows, blocked site data), so every access is
// guarded and the app works without it.

const KEY = 'gusteau.profile.v1';

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
    const { pantry: _pantry, pantryBasics: _basics, ...saved } = JSON.parse(raw) as Partial<Profile> & { pantry?: unknown; pantryBasics?: unknown };
    return { ...NEW_PROFILE, ...saved };
  } catch {
    return NEW_PROFILE;
  }
}

function save(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
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
