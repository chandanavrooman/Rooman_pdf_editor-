# Bundled fonts

The editor embeds these fonts into exported PDFs (via pdf-lib + fontkit) and uses them to draw text in the browser.
Files live in `frontend/src/assets/fonts/`; the full license texts sit next to them (`OFL-*.txt`, `LICENSE-*.txt`).
All are open-licensed and may be embedded in documents. Only Latin (+ Latin Extended) — and for Amiri, Arabic — glyphs are bundled
where noted; text the chosen font cannot draw is reported in the toolbar with a suggested alternative.

| Font (as shown in the editor) | Stands in for | License | Source of the bundled files | Coverage bundled |
|---|---|---|---|---|
| Arial (**Liberation Sans**) | Arial, Helvetica | SIL OFL 1.1 | liberationfonts/liberation-fonts 2.1.5 (TTF release) | full |
| **Arimo** | Arial (metric twin) | SIL OFL 1.1 | `@fontsource/arimo` 5.3.0 (woff2 → TTF) | Latin + Latin Ext |
| Times New Roman (**Liberation Serif**) | Times New Roman, Times | SIL OFL 1.1 | liberation-fonts 2.1.5 | full |
| **Tinos** | Times New Roman (metric twin) | SIL OFL 1.1 | `@fontsource/tinos` 5.3.0 | Latin + Latin Ext |
| Courier / Courier New (**Liberation Mono**) | Courier, Courier New | SIL OFL 1.1 | liberation-fonts 2.1.5 | full |
| **Caladea** (Cambria) | Cambria | SIL OFL 1.1 | `@fontsource/caladea` 5.3.0 | Latin + Latin Ext |
| **Carlito** (Calibri) | Calibri | SIL OFL 1.1 | `@fontsource/carlito` 5.3.0 | Latin + Latin Ext |
| **DejaVu Sans** (Verdana) | Verdana | Bitstream Vera License + public-domain DejaVu changes (free to use, embed and redistribute) | `@fontsource/dejavu-sans` 5.3.0 | as shipped by fontsource ("latin" file is the broad DejaVu set, incl. Arabic and symbols) |
| **DejaVu Serif** (Georgia) | Georgia | Bitstream Vera License + public-domain DejaVu changes | `@fontsource/dejavu-serif` 5.3.0 | as shipped by fontsource |
| **Amiri** (Arabic) | Arabic text | SIL OFL 1.1 | `@fontsource/amiri` 5.3.0 | Latin + Latin Ext + Arabic |
| **Noto Sans** | fallback | SIL OFL 1.1 | Google Noto Sans (already bundled before) | Latin, Greek, Cyrillic, Vietnamese |
| **Open Sans** | Open Sans | SIL OFL 1.1 | `@fontsource/open-sans` 5.3.0 | Latin + Latin Ext |
| **Roboto** | Roboto | SIL OFL 1.1 (per the package's own license file) | `@fontsource/roboto` 5.3.0 | Latin + Latin Ext |

Notes
- The `@fontsource` files are WOFF2 subsets; they were decompressed to TrueType and, where there were several subsets, merged with `fontTools`
  (no glyph was modified). Bold/Italic/Bold-Italic are the real faces; no synthetic styles.
- The OFL requires the license text to travel with the fonts: the `OFL-*` / `LICENSE-*` files in `frontend/src/assets/fonts/` must ship with the app.
- Reserved Font Names (e.g. "Liberation", "Arimo") are unchanged because the font software is not modified.

## Added for in-place editing of LaTeX and Noto Serif documents

- **Noto Serif** (Regular, Bold, Italic, Bold Italic; Latin, Latin Extended, Cyrillic, Greek merged) - SIL Open Font License 1.1. Source: @fontsource/noto-serif. See `frontend/src/assets/fonts/LICENSE-noto-serif.txt`.
- **Latin Modern Roman 10** (stands in for Computer Modern) - GUST Font License. Converted from OpenType/CFF to TrueType outlines with fontTools; no glyph or metric changed. See `frontend/src/assets/fonts/LICENSE-latin-modern.txt`.
