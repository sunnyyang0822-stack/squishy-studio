"""Subset the hall tag font to the glyphs used by the style names.

Source: Resource Han Rounded CN Bold v0.990 (SIL OFL 1.1), downloaded from
https://github.com/CyanoHao/Resource-Han-Rounded/releases/tag/v0.990
Run with fontTools + brotli:  python scripts/build-hall-tag-font.py <path-to-ResourceHanRoundedCN-Bold.ttf>
The subset is a Modified Version under the OFL, so it is renamed.
"""
import re, sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
names = re.search(r"const names = \{([^}]*)\}", (root / 'src/squishy-styles.mjs').read_text(encoding='utf-8')).group(1)
text = ''.join(sorted(set(''.join(re.findall(r"'([^']+)'", names)))))
font = TTFont(sys.argv[1])
options = subset.Options(); options.flavor = 'woff2'; options.layout_features = ['kern', 'palt']; options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
subsetter = subset.Subsetter(options); subsetter.populate(text=text); subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in (1, 4, 16): record.string = 'Squishy Tag Rounded' + (' Bold' if record.nameID == 4 else '')
    if record.nameID == 6: record.string = 'SquishyTagRounded-Bold'
    if record.nameID == 3: record.string = 'SquishyTagRounded-Bold;subset of Resource Han Rounded CN Bold 0.990'
font.flavor = 'woff2'
out = root / 'assets/fonts/squishy-tag-rounded-bold.woff2'
font.save(out)
print(f'{len(text)} glyphs: {text} -> {out.name} {out.stat().st_size} bytes')
