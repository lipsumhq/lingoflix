// Storage keys of the Study Log (v2 spec §3), in one place so the explanation store and the item store don't
// import each other.

/** `log:{id}` holds an explanation. */
export const EXPLANATION_PREFIX = 'log:';
/** `logkey:{videoId}|{language}|{normalized line}` holds the id of that line's explanation. */
export const EXPLANATION_INDEX_PREFIX = 'logkey:';
/** `item:{id}` holds a saved item. */
export const ITEM_PREFIX = 'item:';
/** `itemkey:{videoId}|{line}|{type}|{text}` (normalized, lowercased) holds the id of that saved item. */
export const ITEM_INDEX_PREFIX = 'itemkey:';
/** `true` once the explanations saved before v2 have become saved whole-line items. */
export const MIGRATION_KEY = 'migration:study-log-v2';
