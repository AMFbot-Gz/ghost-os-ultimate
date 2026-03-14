/**
 * src/computer_use/types.js — Constantes partagées pour ComputerUseAdapter
 * Séparé pour éviter les dépendances circulaires entre adapter.js et les implémentations.
 */

export const ACTION_TYPES = Object.freeze({
  CLICK:        'click',
  TYPE_TEXT:    'type_text',
  PRESS_KEY:    'press_key',
  OPEN_APP:     'open_app',
  GOTO_URL:     'goto_url',
  SMART_CLICK:  'smart_click',
  FIND_ELEMENT: 'find_element',
  SCROLL:       'scroll',
  DRAG:         'drag',
  SCREENSHOT:   'screenshot',
  WAIT:         'wait',
});

export const WAIT_TYPES = Object.freeze({
  ELEMENT_VISIBLE: 'element_visible',
  ELEMENT_GONE:    'element_gone',
  APP_FOCUSED:     'app_focused',
  SCREEN_STABLE:   'screen_stable',
  URL_CONTAINS:    'url_contains',
});
