"""Generate the real test fixtures used by the backend / MCP test suites.

Run:  backend/.venv/bin/python tests/fixtures/make_fixtures.py [--large]

Small fixtures are committed. large.pdf (~10MB) is generated on demand
(`--large` or by the pytest session fixture) and git-ignored.
"""
from __future__ import annotations

import io
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

TABLE_HEADER = ["Item", "Region", "Units", "Price", "Total"]
TABLE_ROWS = [
    ["Widget", "North", "120", "2.50", "300.00"],
    ["Gadget", "South", "75", "4.00", "300.00"],
    ["Doohickey", "East", "40", "10.25", "410.00"],
    ["Gizmo", "West", "200", "1.10", "220.00"],
    ["Thingamajig", "North", "15", "99.99", "1499.85"],
]
TABLE_HEADING = "Quarterly Sales Report"
ENTITY_TEXT = "R&D <team> & AT&T said 5 < 7 > 3"
SCANNED_WORDS = ["INVOICE", "TOTAL", "AMOUNT"]
PROTECTED_PASSWORD = "secret123"
PROTECTED_TEXT = "Top secret content inside protected file"


def make_table_pdf(path: Path) -> None:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(path), pagesize=A4, title="Sales table")
    data = [TABLE_HEADER] + TABLE_ROWS
    table = Table(data, colWidths=[90, 80, 60, 60, 70])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f4e79")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#dce6f1")]),
                ("GRID", (0, 0), (-1, -1), 0.8, colors.black),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    doc.build(
        [
            Paragraph(TABLE_HEADING, styles["Title"]),
            Paragraph("Totals by product and region for the quarter.", styles["Normal"]),
            Spacer(1, 18),
            table,
        ]
    )


def make_multipage_pdf(path: Path, pages: int = 12) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Multipage fixture")
    for n in range(1, pages + 1):
        key = f"ch{n}"
        c.bookmarkPage(key)
        c.addOutlineEntry(f"Chapter {n}", key, level=0)
        c.setFont("Helvetica-Bold", 24)
        c.drawString(72, 760, f"Chapter {n} heading")
        c.setFont("Helvetica", 12)
        c.drawString(72, 720, f"This is the unique body text of chapter {n}. Marker CH{n:02d}X.")
        for i in range(20):
            c.drawString(72, 690 - i * 16, f"Line {i + 1} of chapter {n}: lorem ipsum dolor sit amet.")
        c.showPage()
    c.save()


def _font_path() -> str:
    import reportlab

    return str(Path(reportlab.__file__).parent / "fonts" / "Vera.ttf")


def make_scanned_pdf(path: Path) -> None:
    """Image-only PDF (no text layer): rendered words at 200 dpi."""
    from PIL import Image, ImageDraw, ImageFont
    import img2pdf

    font = ImageFont.truetype(_font_path(), 90)
    small = ImageFont.truetype(_font_path(), 60)
    images = []
    for page in range(2):
        img = Image.new("L", (1654, 2339), 255)  # A4 @200dpi
        d = ImageDraw.Draw(img)
        d.text((150, 250), SCANNED_WORDS[0] if page == 0 else "SECOND PAGE", font=font, fill=0)
        d.text((150, 450), f"{SCANNED_WORDS[1]} {SCANNED_WORDS[2]} 4500", font=font, fill=0)
        d.text((150, 700), "Thank you for your business", font=small, fill=0)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        images.append(buf.getvalue())
    layout = img2pdf.get_layout_fun((img2pdf.mm_to_pt(210), img2pdf.mm_to_pt(297)))
    path.write_bytes(img2pdf.convert(images, layout_fun=layout))


def make_protected_pdf(path: Path) -> None:
    import pikepdf
    from reportlab.pdfgen import canvas

    tmp = io.BytesIO()
    c = canvas.Canvas(tmp)
    c.drawString(72, 750, PROTECTED_TEXT)
    c.showPage()
    c.save()
    tmp.seek(0)
    with pikepdf.open(tmp) as pdf:
        pdf.save(
            str(path),
            encryption=pikepdf.Encryption(user=PROTECTED_PASSWORD, owner="owner-" + PROTECTED_PASSWORD, R=6),
        )


def make_entities_pdf(path: Path) -> None:
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path))
    c.setFont("Helvetica", 14)
    c.drawString(72, 750, ENTITY_TEXT)
    c.drawString(72, 720, "Second line plain")
    c.showPage()
    c.save()


def make_large_pdf(path: Path, images: int = 4, size: int = 1400) -> None:
    """Large, compressible PDF: high-res smooth-gradient+noise photos embedded as q95 JPEG."""
    import numpy as np
    from PIL import Image
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    rng = np.random.default_rng(7)
    c = canvas.Canvas(str(path), pagesize=(595, 842))
    for i in range(images):
        yy, xx = np.mgrid[0:size, 0:size]
        base = (
            127
            + 90 * np.sin(xx / (60 + 10 * i))
            + 60 * np.cos(yy / (45 + 7 * i))
        )
        arr = np.stack([base, np.roll(base, 200, 1), np.roll(base, 400, 0)], axis=-1)
        arr = arr + rng.normal(0, 9, arr.shape)
        img = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=92, subsampling=0)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 20, 100, width=555, height=555)
        c.setFont("Helvetica", 12)
        c.drawString(40, 700, f"Large fixture page {i + 1}")
        c.showPage()
    c.save()


def make_office_files() -> None:
    import docx
    import openpyxl
    from pptx import Presentation

    d = docx.Document()
    d.add_heading("Sample Word Document", 1)
    d.add_paragraph("Hello from the Word fixture. " + ENTITY_TEXT)
    t = d.add_table(rows=3, cols=3)
    t.style = "Table Grid"
    for r in range(3):
        for col in range(3):
            t.cell(r, col).text = f"R{r}C{col}"
    d.save(HERE / "sample.docx")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(["Name", "Qty", "Price"])
    ws.append(["Apple", 3, 1.5])
    ws.append(["Pear", 5, 2.25])
    wb.save(HERE / "sample.xlsx")

    p = Presentation()
    s = p.slides.add_slide(p.slide_layouts[1])
    s.shapes.title.text = "Sample Slide Title"
    s.placeholders[1].text = "Slide body text for the PowerPoint fixture"
    p.save(HERE / "sample.pptx")


def make_images() -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (640, 480), (240, 240, 250))
    d = ImageDraw.Draw(img)
    d.rectangle((40, 40, 600, 440), outline=(200, 30, 30), width=8)
    d.ellipse((220, 140, 420, 340), fill=(30, 120, 200))
    img.save(HERE / "sample.png")
    img.save(HERE / "sample.jpg", quality=90)


# ───────────────────────── extra "realistic / tricky" fixtures (feature × document matrix) ─────────────────────────
FORM_VALUES = {"full_name": "Prefilled Name", "subscribe": True, "plan": "pro", "country": "France"}
UNICODE_LINES = ["Café crème brûlée — naïve façade", "Ελληνικά: Καλημέρα κόσμε", "Русский: Привет, мир"]
SINGLE_TEXT = "Single page fixture SNGL01"
SAMPLE_TEXT = "Plain text fixture\nR&D <team> & AT&T: 5 < 7 > 3\nCafé crème, naïve façade, déjà vu\nSecond paragraph line TXT02\n"
OWNER_PASSWORD = "owner-only-pass"


def _noto_font() -> str:
    """OFL-licensed Noto Sans bundled with the frontend (Latin, Greek, Cyrillic)."""
    return str(HERE.parent.parent / "frontend" / "src" / "assets" / "fonts" / "NotoSans_400Regular.ttf")


def make_forms_pdf(path: Path) -> None:
    """AcroForm with a filled text field, a checked checkbox, a radio group with a selection and a dropdown."""
    from reportlab.lib.colors import black
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=(595, 842))
    c.setTitle("Forms fixture")
    c.setFont("Helvetica-Bold", 18)
    c.drawString(72, 780, "Application form FORM01")
    c.setFont("Helvetica", 12)
    form = c.acroForm
    c.drawString(72, 720, "Full name:")
    form.textfield(name="full_name", value=FORM_VALUES["full_name"], x=160, y=712, width=260, height=22,
                   borderColor=black, forceBorder=True)
    c.drawString(72, 680, "Subscribe:")
    form.checkbox(name="subscribe", x=160, y=674, size=16, checked=FORM_VALUES["subscribe"], buttonStyle="check")
    c.drawString(72, 640, "Plan:")
    for i, v in enumerate(["basic", "pro", "team"]):
        form.radio(name="plan", value=v, selected=(v == FORM_VALUES["plan"]), x=160 + i * 80, y=634, size=16)
        c.drawString(180 + i * 80, 638, v)
    c.drawString(72, 600, "Country:")
    form.choice(name="country", value=FORM_VALUES["country"], options=["India", "France", "Peru"], x=160, y=592,
                width=160, height=22)
    c.showPage()
    c.save()


def make_mixed_pdf(path: Path) -> None:
    """Mixed page sizes (A4, Letter, A4 landscape, small), one page with /Rotate 90, an embedded image and a link."""
    import pikepdf
    from reportlab.lib.pagesizes import A4, landscape, letter
    from reportlab.pdfgen import canvas

    tmp = io.BytesIO()
    c = canvas.Canvas(tmp)
    c.setTitle("Mixed fixture")
    sizes = [("A4", A4), ("Letter", letter), ("A4 landscape", landscape(A4)), ("Rotated", A4), ("Small", (300, 400))]
    for i, (label, size) in enumerate(sizes, 1):
        c.setPageSize(size)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(40, size[1] - 60, f"Mixed page {i} {label} MIX{i:02d}")
        c.setFont("Helvetica", 11)
        c.drawString(40, size[1] - 90, "The quick brown fox jumps over the lazy dog.")
        if i == 1:
            c.drawImage(str(HERE / "sample.png"), 40, size[1] - 380, width=256, height=192)
            c.drawString(40, size[1] - 420, "Visit the example site")
            c.linkURL("https://example.com/mixed", (40, size[1] - 425, 200, size[1] - 405), relative=0)
        c.showPage()
    c.save()
    tmp.seek(0)
    with pikepdf.open(tmp) as pdf:
        pdf.pages[3].Rotate = 90
        pdf.save(str(path))


def make_unicode_pdf(path: Path) -> None:
    """Accented Latin, Greek and Cyrillic text in an embedded TrueType font (Noto Sans, OFL)."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(TTFont("NotoSans", _noto_font()))
    c = canvas.Canvas(str(path), pagesize=(595, 842))
    c.setTitle("Unicode fixture — Ελληνικά")
    for page in range(2):
        c.setFont("NotoSans", 16)
        y = 760
        for line in UNICODE_LINES:
            c.drawString(60, y, f"{line} UNI{page + 1}")
            y -= 34
        c.showPage()
    c.save()


def make_images_pdf(path: Path, n: int = 3) -> None:
    """Photo-like pages: smooth gradients + shapes + noise, embedded as JPEG (moderate size)."""
    import numpy as np
    from PIL import Image, ImageDraw
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    rng = np.random.default_rng(11)
    c = canvas.Canvas(str(path), pagesize=(595, 842))
    for i in range(n):
        yy, xx = np.mgrid[0:900, 0:1200]
        r = 120 + 100 * np.sin(xx / (90 + 20 * i))
        g = 120 + 90 * np.cos(yy / (70 + 15 * i))
        b = 140 + 60 * np.sin((xx + yy) / 150)
        arr = np.clip(np.stack([r, g, b], -1) + rng.normal(0, 6, (900, 1200, 3)), 0, 255).astype("uint8")
        img = Image.fromarray(arr)
        d = ImageDraw.Draw(img)
        d.ellipse((300 + 60 * i, 200, 700 + 60 * i, 600), fill=(250, 220, 60))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
        buf.seek(0)
        c.drawImage(ImageReader(buf), 40, 200, width=515, height=386)
        c.setFont("Helvetica", 14)
        c.drawString(40, 780, f"Photo page {i + 1} IMG{i + 1:02d}")
        c.showPage()
    c.save()


def make_owner_only_pdf(path: Path) -> None:
    """Opens without a password (empty user password) but has an owner password and restricted permissions."""
    import pikepdf

    src = HERE / "single.pdf"
    with pikepdf.open(src) as pdf:
        perms = pikepdf.Permissions(extract=False, modify_annotation=False, modify_form=False, modify_other=False,
                                    modify_assembly=False, print_highres=False, print_lowres=True, accessibility=True)
        pdf.save(str(path), encryption=pikepdf.Encryption(user="", owner=OWNER_PASSWORD, R=6, allow=perms))


def make_single_pdf(path: Path) -> None:
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=(595, 842))
    c.setTitle("Single fixture")
    c.setFont("Helvetica", 18)
    c.drawString(72, 760, SINGLE_TEXT)
    c.showPage()
    c.save()


def make_corrupted_pdf(path: Path) -> None:
    """A real PDF whose cross-reference table and startxref are broken (every offset wrong) — recoverable by repair."""
    import re

    good = (HERE / "multipage.pdf").read_bytes()
    xref_at = good.rfind(b"\nxref")
    if xref_at < 0:  # object-stream PDFs: rewrite as a classic xref file first
        import pikepdf

        buf = io.BytesIO()
        with pikepdf.open(HERE / "multipage.pdf") as pdf:
            pdf.save(buf, object_stream_mode=pikepdf.ObjectStreamMode.disable)
        good = buf.getvalue()
        xref_at = good.rfind(b"\nxref")
    head, tail = good[:xref_at], good[xref_at:]
    tail = re.sub(rb"\d{10} 00000 n", b"0000000999 00000 n", tail)       # every object offset wrong
    tail = re.sub(rb"startxref\s+\d+", b"startxref\n123", tail)          # startxref points into the middle of nowhere
    path.write_bytes(head + tail)


def make_fake_pdf(path: Path) -> None:
    path.write_text("This is not a PDF, just text with a .pdf extension.\n", encoding="utf-8")


def make_sample_txt(path: Path) -> None:
    path.write_text(SAMPLE_TEXT, encoding="utf-8")


def make_extra() -> None:
    make_single_pdf(HERE / "single.pdf")
    make_forms_pdf(HERE / "forms.pdf")
    make_mixed_pdf(HERE / "mixed.pdf")
    make_unicode_pdf(HERE / "unicode.pdf")
    make_images_pdf(HERE / "images.pdf")
    make_owner_only_pdf(HERE / "owner-only.pdf")
    make_corrupted_pdf(HERE / "corrupted.pdf")
    make_fake_pdf(HERE / "fake.pdf")
    make_sample_txt(HERE / "sample.txt")


def make_all(large: bool = False) -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    make_table_pdf(HERE / "table.pdf")
    make_multipage_pdf(HERE / "multipage.pdf")
    make_scanned_pdf(HERE / "scanned.pdf")
    make_protected_pdf(HERE / "protected.pdf")
    make_entities_pdf(HERE / "entities.pdf")
    make_office_files()
    make_images()
    make_extra()
    if large or not (HERE / "large.pdf").exists():
        make_large_pdf(HERE / "large.pdf")


def ensure_large() -> Path:
    p = HERE / "large.pdf"
    if not p.exists():
        make_large_pdf(p)
    return p


if __name__ == "__main__":
    if "--extra-only" in sys.argv:  # only (re)build the matrix fixtures, keep the committed originals byte-identical
        make_extra()
    else:
        make_all(large="--large" in sys.argv or True)
    for f in sorted(HERE.iterdir()):
        if f.is_file() and f.suffix != ".py":
            print(f"{f.name:20s} {f.stat().st_size:>10,d} bytes")
