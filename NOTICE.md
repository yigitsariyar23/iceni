# Third-party notices

## Catppuccin for Spicetify -- MIT

`color.ini`, `user.css`, `theme.js` and `assets/` in this repository are derived
from [catppuccin/spicetify](https://github.com/catppuccin/spicetify), which is
licensed under the MIT License. The full text is in [LICENSE](LICENSE).

The derived work has been reduced to a single color scheme, had palette errors
corrected, and had `theme.js` rewritten. See the git history for details.

## Not included in this repository

Two extensions are used but are **not** redistributed here. Both are gitignored
and fetched or built on demand by the scripts in `scripts/`:

| Extension | License | How it is obtained |
|---|---|---|
| [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) | AGPL-3.0 | `scripts/vendor-spicy-lyrics.sh` downloads the published bundle at install time |
| [SpicyLyricTranslator](https://github.com/7xeh/SpicyLyricTranslator) | SLT Source-Available License v1.0 | `scripts/vendor-slt.sh` builds it from a local private fork |

The SLT license permits forking for private use but prohibits publishing or
releasing a fork. The fork referenced by `vendor.lock` must therefore stay
private. Nothing in this repository contains SLT or Spicy Lyrics source code.
