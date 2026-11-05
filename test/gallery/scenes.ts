/**
 * The gallery's scenes: each is one state of the extension's UI, drawn with the real components and
 * stylesheets over made-up books (`?scene=<id>`). The visual tests take one screenshot of each. Plain
 * data, so the Playwright spec can read it without React or a DOM.
 */
export const SCENES = [
  {
    id: 'cards',
    title:
      'Badges, labels, a highlighted cover, a highlighted price and a dimmed card',
  },
  { id: 'carousel', title: 'Highlighted covers in a carousel that clips' },
  { id: 'overview', title: 'The rating overview on hover' },
  { id: 'label-show', title: 'Label popover: shown, filters off' },
  { id: 'label-hidden', title: 'Label popover: hidden' },
  { id: 'label-saved', title: 'Label popover: just highlighted' },
  { id: 'label-help', title: 'Label popover: the explanation open' },
  { id: 'panel', title: 'Panel: progress and the filter switch' },
  { id: 'panel-filters', title: 'Panel: filter settings open' },
  { id: 'panel-info', title: 'Panel: an explanation open' },
  { id: 'panel-paused', title: 'Panel: Goodreads is rate limiting' },
  { id: 'pill-on', title: 'Pill: filtering on, with counts' },
  { id: 'pill-off', title: 'Pill: filtering off' },
] as const

export type SceneId = (typeof SCENES)[number]['id']

/** The viewport every scene is drawn and captured in. */
export const VIEWPORT = { width: 960, height: 640 } as const

/** Set on `<html>` once a scene has finished drawing, so a screenshot waits for it. */
export const READY = 'data-gallery-ready'
