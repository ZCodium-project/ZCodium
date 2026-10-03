# python-pptx Recipes

Load this file only when a PPTX reading task turns into targeted `python-pptx` editing or low-level scripting.

## Speaker Notes

```python
from pptx import Presentation

prs = Presentation("deck.pptx")
slide = prs.slides[0]

if slide.has_notes_slide:
    print(slide.notes_slide.notes_text_frame.text)

notes_slide = slide.notes_slide
tf = notes_slide.notes_text_frame
tf.clear()
tf.text = "Your speaker notes here"

prs.save("deck-with-notes.pptx")
```

## Slide Iteration

```python
for i, slide in enumerate(prs.slides, 1):
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                print(f"Slide {i}: {para.text}")
        if shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    print(cell.text)
```

## Add Formatted Text

```python
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

slide = prs.slides[0]
tx_box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2))
tf = tx_box.text_frame
p = tf.paragraphs[0]
run = p.add_run()
run.text = "Formatted text"
run.font.size = Pt(24)
run.font.bold = True
run.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
```

## Layout and Dimensions

```python
width = prs.slide_width
height = prs.slide_height

slide = prs.slides[0]
print(slide.slide_layout.name)
```
