/** Bundled recipe photos belong under the app's base, regardless of the page URL. */
export function recipeImageUrl(image: string, base = '/'): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(image)) return image;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  if (image.startsWith(prefix)) return image;
  return prefix + image.replace(/^(?:\.\/|\/)+/, '');
}
