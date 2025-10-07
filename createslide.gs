/*************************************************
 * Google Slides – Multiple Choice Quiz Builder (fixed TextStyle callbacks)
 * - Uses SlidesApp.ShapeType.RECTANGLE
 * - Centers text via paragraph style
 * - Uses getBorder().getLineFill() instead of getLine()
 * - Passes TextStyle (not TextRange) to callbacks
 * - Includes ID prompt, menu, and legacy myFunction wrapper
 *
 * Entrypoints:
 *   buildNewQuizDeck()          -> create a new deck
 *   buildQuizInExistingDeck()   -> write into an existing deck (auto-detect / prompt)
 **************************************************/

/* =========================
   SLIDES ID HANDLING
========================= */

// Leave blank to use active deck or prompt
const PRESENTATION_ID = "1lsNam3OMuol_lxdplqXKQJ57D8m2ZHUaGxdmdx2uwEQ";

// Store/reuse Slides ID in Script Properties
function _getStoredPresentationId() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty("QUIZ_PRESENTATION_ID") || "";
}
function _setStoredPresentationId(id) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("QUIZ_PRESENTATION_ID", id);
}
function _parseSlidesId(idOrUrl) {
  const s = String(idOrUrl || "").trim();
  if (!s) return "";
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m && m[1]) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return "";
}
function _promptForSlidesId() {
  let ui;
  try { ui = SlidesApp.getUi(); } catch (e) {}
  if (!ui) {
    try { ui = SpreadsheetApp.getUi(); } catch (e2) {}
  }
  if (!ui) throw new Error("Open Slides/Sheets to prompt for the Slides ID, or set it in code.");
  const res = ui.prompt(
    "Google Slides ID or URL",
    "Paste the full Slides URL or the presentation ID, then click OK.",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) throw new Error("Slides ID entry cancelled.");
  const id = _parseSlidesId(res.getResponseText());
  if (!id) throw new Error("Could not parse a valid Slides ID from what you entered.");
  _setStoredPresentationId(id);
  return id;
}
function _resolvePresentationIdOrThrow() {
  let id = (PRESENTATION_ID || "").trim();
  if (id) return id;
  id = _getStoredPresentationId();
  if (id) return id;
  try {
    const active = SlidesApp.getActivePresentation();
    if (active) {
      id = active.getId();
      if (id) return id;
    }
  } catch (e) {}
  return _promptForSlidesId();
}
function setPresentationIdManually() {
  const id = _promptForSlidesId();
  Logger.log("Slides ID saved: " + id);
}

/* =========================
   MENU + LEGACY WRAPPER
========================= */

function onOpen() {
  try {
    SlidesApp.getUi()
      .createMenu("Quiz Builder")
      .addItem("Build NEW Quiz Deck", "buildNewQuizDeck")
      .addItem("Build in EXISTING Deck", "buildQuizInExistingDeck")
      .addSeparator()
      .addItem("Set Slides ID…", "setPresentationIdManually")
      .addToUi();
    return;
  } catch (e) {}
  try {
    SpreadsheetApp.getUi()
      .createMenu("Quiz Builder")
      .addItem("Build NEW Quiz Deck", "buildNewQuizDeck")
      .addItem("Build in EXISTING Deck", "buildQuizInExistingDeck")
      .addSeparator()
      .addItem("Set Slides ID…", "setPresentationIdManually")
      .addToUi();
  } catch (e2) {}
}

// If something still calls myFunction, run the existing-deck builder.
function myFunction() {
  buildQuizInExistingDeck();
}

/* =========================
   CANVAS & STYLE
========================= */

const CANVAS = { width: 960, height: 540 }; // 16:9

const STYLE = {
  bg:       "#0f1115",
  card:     "#151923",
  text:     "#e9edf1",
  muted:    "#8b93a7",
  accent:   "#34c759",  // correct (green)
  danger:   "#ff3b30",  // wrong (red)
  border:   "#232a3a",
  title: { size: 28, bold: true },
  body:  { size: 16, bold: false },
  choice:{ size: 18, bold: true }
};

/* =========================
   QUIZ BANK
========================= */

const QUIZ = [
  {
    id: "Q1",
    q: "What field in Airtable is used to store whether a record is Approved or Disputed?",
    choices: ["Job Name", "Approved or Dispute", "Vendor Amount to Backcharge", "Field Technician"],
    correctIndex: 1
  },
  {
    id: "Q2",
    q: "What happens in the app when you swipe a card to the right?",
    choices: ["It deletes the record", "It opens the photo modal", "It marks the record as Approved", "It marks the record as Disputed"],
    correctIndex: 2
  },
  {
    id: "Q3",
    q: "Which field links the record to the subcontractor responsible for the backcharge?",
    choices: ["Customer", "Subcontractor to Backcharge", "Vendor Brick and Mortar Location", "Reason for Builder Backcharge"],
    correctIndex: 1
  },
  {
    id: "Q4",
    q: "Where are uploaded photos stored after being added in the app?",
    choices: ["Only in the browser cache", "Airtable “Photos” field + Dropbox", "A Google Drive folder", "Email attachments"],
    correctIndex: 1
  },
  {
    id: "Q5",
    q: "Swiping a card to the left in the review screen will…",
    choices: ["Approve the backcharge", "Dispute the backcharge", "Archive the record", "Refresh the page"],
    correctIndex: 1
  },
  {
    id: "Q6",
    q: "Which Airtable field is used in the app to filter jobs by location?",
    choices: ["Vanir Branch", "Job Name", "Customer", "GM/ACM Outcome"],
    correctIndex: 0
  },
  {
    id: "Q7",
    q: "Which field identifies whether a record is Builder Issued or Vendor Issued?",
    choices: ["Type of Backcharge", "Builder Backcharged Amount", "Secondary Subcontractor to Backcharge", "Photos"],
    correctIndex: 0
  },
  {
    id: "Q8",
    q: "What is the difference between “Sub Backcharge Amount” and “Vendor Amount to Backcharge”?",
    choices: ["They are the same", "Sub applies to subcontractors; Vendor applies to vendors", "Sub applies only to approved records; Vendor to disputed", "Sub is numeric, Vendor is text"],
    correctIndex: 1
  },
  {
    id: "Q9",
    q: "Which Airtable field links back to the vendor being backcharged?",
    choices: ["Vendor to Backcharge (or Vendor Brick and Mortar Location)", "Customer", "Job Name", "Approved or Dispute"],
    correctIndex: 0
  },
  {
    id: "Q10",
    q: "Which calculated field can be added to see the combined backcharge amount for Builder, Subcontractor, and Vendor?",
    choices: ["Job Name", "Total Backcharge Amount", "Reason for Builder Backcharge", "GM/ACM Outcome"],
    correctIndex: 1
  }
];

/* =========================
   ENTRYPOINTS
========================= */

function buildNewQuizDeck() {
  const title = "Backcharge Review – Quiz";
  const pres = SlidesApp.create(title);
  Logger.log("Created deck: " + pres.getId());
  const deck = new DeckWrapper(pres);
  buildQuizSlides(deck);
}

function buildQuizInExistingDeck() {
  const id = _resolvePresentationIdOrThrow();
  const pres = SlidesApp.openById(id);
  const deck = new DeckWrapper(pres);
  buildQuizSlides(deck);
}

/* =========================
   CORE BUILDER
========================= */

function buildQuizSlides(deck) {
  // Intro
  createIntroSlide(deck, "Backcharge Review – Quiz", "Tap an answer on each slide. Correct advances; wrong lets you try again.");

  const perQuestion = [];

  // Build question + feedback slides
  for (let i = 0; i < QUIZ.length; i++) {
    const q = QUIZ[i];
    const questionSlide = createQuestionSlide(deck, q, i + 1, QUIZ.length);
    const correctSlide  = createFeedbackSlide(deck, q, true);
    const wrongSlide    = createFeedbackSlide(deck, q, false);
    perQuestion.push({ questionSlide, correctSlide, wrongSlide });
  }

  // Link navigation/answers
  for (let i = 0; i < QUIZ.length; i++) {
    const { questionSlide, correctSlide, wrongSlide } = perQuestion[i];
    const isLast = (i === QUIZ.length - 1);
    const nextQuestionSlide = !isLast ? perQuestion[i + 1].questionSlide : null;

    linkQuestionChoices(questionSlide, QUIZ[i], correctSlide, wrongSlide);
    linkFeedbackSlides(correctSlide, wrongSlide, questionSlide, nextQuestionSlide, isLast);
  }

  // End slide + link from last correct
  const thanks = createEndSlide(deck, "Great job!", "You’ve completed the Backcharge Review quiz.");
  const lastCorrect = perQuestion[perQuestion.length - 1].correctSlide;
  addButton(
    lastCorrect, CANVAS.width / 2 - 90, CANVAS.height - 120, 180, 44,
    "Finish", STYLE.accent, "#0f1115",
    function(ts) { ts.setBold(true).setFontSize(16).setLinkSlide(thanks); }
  );
}

/* =========================
   SLIDE CREATORS
========================= */

function createIntroSlide(deck, title, subtitle) {
  const s = deck.blank();
  s.getBackground().setSolidFill(STYLE.bg);

  const titleBox = s.insertTextBox(title, 60, 100, CANVAS.width - 120, 80);
  styleTitle(titleBox);

  const subBox = s.insertTextBox(subtitle, 80, 180, CANVAS.width - 160, 60);
  styleBody(subBox);

  return s;
}

function createQuestionSlide(deck, q, idx, total) {
  const s = deck.blank();
  s.getBackground().setSolidFill(STYLE.bg);

  const header = `${q.id} of ${total}`;
  const headerBox = s.insertTextBox(header, 60, 40, CANVAS.width - 120, 30);
  styleMuted(headerBox);

  const qBox = s.insertTextBox(`${q.id}: ${q.q}`, 60, 80, CANVAS.width - 120, 80);
  styleTitle(qBox);

  // 2 x 2 buttons
  const btnW = 360, btnH = 56, gapX = 24, gapY = 18;
  const left = (CANVAS.width - btnW * 2 - gapX) / 2;
  const top  = 200;
  const labels = ["A", "B", "C", "D"];

  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = (i / 2) | 0;
    const x = left + col * (btnW + gapX);
    const y = top + row * (btnH + gapY);

    // Shape
    const btn = s.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, btnW, btnH);
    btn.getFill().setSolidFill(STYLE.card);

    // Border (outline)
    const border = btn.getBorder();
    border.setWeight(1);
    border.getLineFill().setSolidFill(STYLE.border);

    // Text
    const t = btn.getText();
    t.setText(`${labels[i]}) ${q.choices[i]}`);
    t.getTextStyle()
      .setFontSize(STYLE.choice.size)
      .setBold(STYLE.choice.bold)
      .setForegroundColor(STYLE.text);
    t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  }

  return s;
}

function createFeedbackSlide(deck, q, isCorrect) {
  const s = deck.blank();
  s.getBackground().setSolidFill(STYLE.bg);

  const title = isCorrect ? "Correct ✅" : "Try Again ❌";
  const titleColor = isCorrect ? STYLE.accent : STYLE.danger;

  const titleBox = s.insertTextBox(title, 60, 120, CANVAS.width - 120, 60);
  styleTitle(titleBox, titleColor);

  const msg = isCorrect
    ? `Nice! ${q.id} is correct.`
    : `That’s not quite right for ${q.id}.`;
  const sub = s.insertTextBox(msg, 60, 190, CANVAS.width - 120, 40);
  styleBody(sub);

  return s;
}

function createEndSlide(deck, title, subtitle) {
  const s = deck.blank();
  s.getBackground().setSolidFill(STYLE.bg);

  const t = s.insertTextBox(title, 60, 140, CANVAS.width - 120, 80);
  styleTitle(t, STYLE.accent);

  const sub = s.insertTextBox(subtitle, 60, 220, CANVAS.width - 120, 60);
  styleBody(sub);

  return s;
}

/* =========================
   LINKING / BUTTONS
========================= */

function linkQuestionChoices(questionSlide, q, correctSlide, wrongSlide) {
  // Grab all shapes on slide; last 4 are our answer buttons
  const shapes = questionSlide.getPageElements()
    .filter(el => el.getPageElementType() === SlidesApp.PageElementType.SHAPE)
    .map(el => el.asShape());

  const choiceButtons = shapes.slice(-4);

  for (let i = 0; i < choiceButtons.length; i++) {
    const shape = choiceButtons[i];
    const isRight = (i === q.correctIndex);

    // Optional visual hint on correct
    if (isRight) {
      shape.getFill().setSolidFill("#163b23");
      const b = shape.getBorder();
      b.setWeight(1);
      b.getLineFill().setSolidFill(STYLE.accent);
    } else {
      shape.getFill().setSolidFill(STYLE.card);
      const b = shape.getBorder();
      b.setWeight(1);
      b.getLineFill().setSolidFill(STYLE.border);
    }

    // Make the button link to the appropriate slide
    const tr = shape.getText();
    tr.getTextStyle().setLinkSlide(isRight ? correctSlide : wrongSlide);
  }
}

function linkFeedbackSlides(correctSlide, wrongSlide, questionSlide, nextQuestionSlide, isLast) {
  addButton(
    correctSlide,
    CANVAS.width / 2 - 190,
    CANVAS.height - 140,
    180,
    44,
    isLast ? "Finish (next set on slide)" : "Next Question",
    STYLE.accent,
    "#0f1115",
    function(ts) {
      ts.setBold(true).setFontSize(16);
      if (!isLast && nextQuestionSlide) ts.setLinkSlide(nextQuestionSlide);
    }
  );

  addButton(
    wrongSlide,
    CANVAS.width / 2 - 90,
    CANVAS.height - 140,
    180,
    44,
    "Back to Question",
    STYLE.danger,
    "#ffffff",
    function(ts) {
      ts.setBold(true).setFontSize(16).setLinkSlide(questionSlide);
    }
  );
}

function addButton(slide, x, y, w, h, label, fillColor, textColor, afterTextStyleCb) {
  const btn = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  btn.getFill().setSolidFill(fillColor || STYLE.card);

  const border = btn.getBorder();
  border.setWeight(1);
  border.getLineFill().setSolidFill(STYLE.border);

  const tr = btn.getText();
  tr.setText(label || "Button");
  tr.getTextStyle()
    .setForegroundColor(textColor || STYLE.text)
    .setBold(true)
    .setFontSize(16);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  // 🔧 Pass TextStyle to callback (not TextRange)
  const ts = tr.getTextStyle();
  if (typeof afterTextStyleCb === "function") afterTextStyleCb(ts);

  return btn;
}

/* =========================
   TEXT STYLES
========================= */

function styleTitle(textBox, colorOpt) {
  const t = textBox.getText();
  t.getTextStyle()
    .setForegroundColor(colorOpt || STYLE.text)
    .setBold(!!STYLE.title.bold)
    .setFontSize(STYLE.title.size);
  t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}
function styleBody(textBox) {
  const t = textBox.getText();
  t.getTextStyle()
    .setForegroundColor(STYLE.muted)
    .setBold(!!STYLE.body.bold)
    .setFontSize(STYLE.body.size);
  t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}
function styleMuted(textBox) {
  const t = textBox.getText();
  t.getTextStyle()
    .setForegroundColor(STYLE.muted)
    .setBold(false)
    .setFontSize(14);
  t.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}

/* =========================
   DECK WRAPPER
========================= */

class DeckWrapper {
  constructor(pres) {
    this.pres = pres;
  }
  blank() {
    return this.pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  }
}
