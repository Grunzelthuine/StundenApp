// Geometrie der Muster-PDF "Stundenzettel" (Elektro Speckmann GmbH)
// Alle Koordinaten in PDF-Punkten, Ursprung oben links (y = Abstand von der Seitenoberkante),
// so wie sie aus der Vorlage vermessen wurden. Umrechnung in PDF-Koordinaten (Ursprung unten
// links) erfolgt in app.js über topToPdfY().

const TEMPLATE = {
  pageWidth: 612,
  pageHeight: 792,

  // Kopfzeile
  header: {
    nameLabelRight: 138,   // Ende von "Name, Vorname:"
    nameValueX: 145,
    nameBaselineTop: 71,   // y (von oben) für die Grundlinie des Namens
    nameValueMaxX: 300,    // bis kurz vor "Monat:"

    monatLabelRight: 340,
    monatValueX: 345,
    monatBaselineTop: 68,
    monatValueMaxX: 455,

    jahrValueCenterX: 527, // Mitte des vorgedruckten "2025" — wird überklebt und neu beschriftet
    jahrBaselineTop: 67,
    jahrBoxX0: 500, jahrBoxX1: 555, jahrBoxTop: 52, jahrBoxBottom: 70 // Weißfläche zum Überdecken von "2025"
  },

  // Spalten (x0 = links, x1 = rechts), gemessen an der Vorlage
  cols: {
    datum:      { x0: 54.75,  x1: 107.5 },
    kunde:      { x0: 107.5,  x1: 204.25 },
    beschr:     { x0: 204.25, x1: 501.5 },
    zeitKunde:  { x0: 501.5,  x1: 533.5 },
    zeitGesamt: { x0: 533.5,  x1: 564.75 }
  },

  // Innenabstand links für Text in den Spalten
  padLeft: 5,

  // 8 Zeilen-Blöcke pro Blatt. top/mid/bottom = Rahmenlinien (von oben gemessen).
  // aufmassTop/aufmassBottom = die kleine "Aufmaß Ja/Nein"-Box in der Lücke unter dem Block.
  rows: [
    { top: 201.2, mid: 219.0, bottom: 236.5, aufmassTop: 236.5, aufmassBottom: 253.0 },
    { top: 261.0, mid: 278.5, bottom: 296.2, aufmassTop: 296.2, aufmassBottom: 312.7 },
    { top: 319.8, mid: 337.5, bottom: 355.0, aufmassTop: 355.0, aufmassBottom: 371.5 },
    { top: 378.5, mid: 396.0, bottom: 413.5, aufmassTop: 413.5, aufmassBottom: 430.0 },
    { top: 436.2, mid: 453.5, bottom: 471.0, aufmassTop: 471.0, aufmassBottom: 487.5 },
    { top: 495.2, mid: 512.8, bottom: 530.5, aufmassTop: 530.5, aufmassBottom: 547.0 },
    { top: 554.0, mid: 571.8, bottom: 589.5, aufmassTop: 589.5, aufmassBottom: 606.0 },
    { top: 614.0, mid: 632.0, bottom: 649.8, aufmassTop: 649.8, aufmassBottom: 666.3 }
  ],

  // Ja/Nein-Kästchen der Aufmaß-Mini-Box (x-Bereich, innerhalb aufmassTop/aufmassBottom)
  aufmass: {
    jaX0: 453.5, jaX1: 477.7,
    neinX0: 477.7, neinX1: 502.0
  },

  entriesPerPage: 8
};
