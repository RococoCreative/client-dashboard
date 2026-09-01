# Brand fonts

This repository is public, so the licensed Rococo Creative faces (Goldenbook, Halcom) are
not committed here. The Rococo theme falls back to Cormorant Garamond and Instrument Sans
from Google Fonts, which the design system lists as its approved fallbacks.

To ship the real faces on a private deployment: copy the `woff2` files from the private
`design-system` repo (`fonts/woff2/`) into this folder and uncomment the `@font-face`
block at the top of `src/index.css`. The family names already match.
