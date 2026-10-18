# Ideas

Not planned yet; notes so they are not lost.

## Fine wheel position ("alignment"), an advanced option, off by default

Labels have three positions per digit (5, 5/6, 6). A wheel that stopped at 5.8 is labelled
6 and trains as 100 % "6", although the device's `DoubleHyprid10` decoding could read 5.8
(target 0.2 on 5, 0.8 on 6: `6 − 0.2 / (0.2 + 0.8)`).

- In the review, open an image large and drag it up or down until the digit sits in the
  middle of the window (a black band shows at the edge). The image is not cropped; only
  the training target moves towards the neighbour. Show the shares at the top and bottom
  ("5: 20 %" / "6: 80 %"); a "5/6" image starts at 50/50 and can be turned either way.
- Keep the position next to the label (label stays "6", position 5.8); the target comes
  from the position. Put it in the CSV and the exports.
- Suggest the position automatically: match the image against the wheel's mean image of
  that digit (images at rest), the drag only corrects it.
- The wheel's pitch (pixels per digit) is needed to turn pixels into a fraction and is set
  once per wheel (about ¾ of the crop height).

Checked on the watermeter crops (81 × 46 px), 2026-10-19:

- Matching against the digit's mean image finds the vertical shift: wheels at rest come
  out at 0 ± 1 px, turning wheels (dig6–dig8) show clear shifts of 5–25 px.
- The pitch cannot be measured from the file names: this meter reads with `dig-class11`,
  which gives whole digits only. Estimating it from the mean images was unreliable
  (61 px on dig5 and dig8, 16–23 px on dig6 and dig7), so set it by hand.
- On dig4, the "2" at rest moved 4 px over the days (camera or ROI moved); what counts for
  the model is the position in the window.

## Test images without near-duplicates

The test split is not cleaned of near-duplicates, so a wheel that stood still for hours at
one in-between position shows up as dozens of identical "mistakes" (seen: 25 of 29 on
dig8) and weighs that much in the comparison with the installed model.
