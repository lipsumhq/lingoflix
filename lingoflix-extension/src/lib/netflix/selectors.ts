/** Netflix's subtitle layer. Verified in docs/netflix-internals.md (row 1). */
export const SUBTITLE_LAYER_SELECTOR = '.player-timedtext';

/** One block of visible subtitle text; two-line subtitles are one container (docs/netflix-internals.md). */
export const SUBTITLE_TEXT_SELECTOR = '.player-timedtext-text-container';

/** Netflix's player container, which is also the fullscreen element (docs/netflix-internals.md row 6). */
export const PLAYER_CONTAINER_SELECTOR = 'div.watch-video[data-uia="watch-video"]';
