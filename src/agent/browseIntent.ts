import { matchCuisine } from '../data/cuisines';
import { GRAINS, PROTEINS, type GrainId, type ProteinId } from '../data/ingredients';
import { DIET_RULES, DIET_RULE_IDS } from '../data/rules';
import type { Filters } from './kitchen';

// Voice or typed requests while browsing, e.g. "something vegetarian and
// Thai under 20 minutes" or "I have rice, eggs and spinach".

export interface BrowseIntent {
  filters: Partial<Filters>;
  addPantry: string[];
  /** What Gusteau understood, for the toast. */
  summary: string[];
}

const NUMBER_WORDS: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, sixty: 60 };

export function parseBrowseIntent(raw: string): BrowseIntent {
  const m = raw.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.]/g, ' ').trim();
  const filters: Partial<Filters> = {};
  const summary: string[] = [];

  const have = m.match(/\b(?:i (?:have|got)|i'?ve got|in my (?:fridge|kitchen|pantry)(?: (?:is|are))?|using)\s+(.+)$/);
  if (have) {
    const items = have[1]
      .split(/,|\band\b|\bplus\b/)
      .map((s) => s.replace(/\b(some|a|an|the|few|bit of|leftover)\b/g, '').trim())
      .filter((s) => s && s.split(' ').length <= 3);
    if (items.length) {
      summary.push(`Added ${items.join(', ')} to your kitchen`);
      filters.pantryOnly = true;
      return { filters, addPantry: items, summary };
    }
  }

  const cuisine = matchCuisine(m);
  if (cuisine) {
    filters.cuisine = cuisine;
    summary.push(cuisine.replace(/-/g, ' '));
  }
  const diet = DIET_RULE_IDS.filter((r) => m.includes(r.replace('-', ' ')) || m.includes(r) || m.includes(DIET_RULES[r].label.toLowerCase()));
  if (diet.length) {
    filters.diet = diet;
    summary.push(...diet.map((d) => DIET_RULES[d].label));
  }
  const proteins = (Object.keys(PROTEINS) as ProteinId[]).filter((p) => PROTEINS[p].re.test(m));
  if (proteins.length) {
    filters.proteins = proteins;
    summary.push(...proteins.map((p) => PROTEINS[p].label));
  }
  const grains = (Object.keys(GRAINS) as GrainId[]).filter((g) => GRAINS[g].re.test(m));
  if (grains.length) {
    filters.grains = grains;
    summary.push(...grains.map((g) => GRAINS[g].label));
  }
  const time = m.match(/\b(?:under|less than|within|in|max|at most)\s+(\d+|ten|fifteen|twenty|thirty|forty|forty five|sixty)\s*(?:min|mins|minutes)\b/);
  if (time) {
    filters.maxMinutes = NUMBER_WORDS[time[1]] ?? parseInt(time[1], 10);
    summary.push(`Under ${filters.maxMinutes} min`);
  } else if (/\b(quick|fast|speedy)\b/.test(m)) {
    filters.maxMinutes = 20;
    summary.push('Under 20 min');
  }
  if (/\beasy|simple|beginner\b/.test(m)) {
    filters.difficulty = ['Easy'];
    summary.push('Easy');
  }
  if (/\b(veg(gie|etable)[- ]?(heavy|forward|packed)|lots of veg)/.test(m)) {
    filters.vegForward = true;
    summary.push('Veg-forward');
  }
  if (!summary.length) {
    // Nothing structured: treat it as a search, minus the filler words.
    const q = m.replace(/\b(i want|i'?d like|i'?m craving|craving|show me|find|something|some|a|an|the|recipe|recipes|dish|dishes|to make|make|cook|for dinner|tonight|please)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (q) {
      filters.search = q;
      summary.push(`“${q}”`);
    }
  }
  return { filters, addPantry: [], summary };
}
