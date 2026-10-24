// src/index.ts
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
import { appendPluginRecord } from "@deepseek-ai/dsh-session";

// src/boards.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
var MAX_BOARD_BYTES = 4 * 1024 * 1024;
var MAX_BOARDS = 200;
function fmt(value) {
  if (value === void 0 || !Number.isFinite(value)) return "?";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}
function sheetText(sheet) {
  if (sheet === void 0 || sheet.length === 0) return "(\u7A7A)";
  return sheet.map((entry) => entry.text).join("  ");
}
function diffSheets(before, after) {
  const old = new Map((before ?? []).map((entry) => [entry.label, entry]));
  const now = new Map((after ?? []).map((entry) => [entry.label, entry]));
  const added = (after ?? []).filter((entry) => !old.has(entry.label));
  const removed = (before ?? []).filter((entry) => !now.has(entry.label)).map((entry) => entry.label);
  const moved = [];
  const changed = [];
  for (const [label, entry] of now) {
    const previous = old.get(label);
    if (previous === void 0) continue;
    if (entry.x !== void 0 && previous.x !== void 0) {
      if (fmt(entry.x) !== fmt(previous.x) || fmt(entry.y) !== fmt(previous.y)) {
        moved.push(`${label} \u2192 (${fmt(entry.x)}, ${fmt(entry.y)})`);
      }
    } else if (entry.definition !== previous.definition) {
      changed.push(label);
    }
  }
  return { added, removed, moved, changed };
}
function diffText(before, after) {
  const diff = diffSheets(before, after);
  const parts = [];
  if (diff.added.length > 0) parts.push(`\u65B0\u589E ${diff.added.map((entry) => entry.text).join("\u3001")}`);
  if (diff.removed.length > 0) parts.push(`\u5220\u9664 ${diff.removed.join("\u3001")}`);
  if (diff.moved.length > 0) parts.push(`\u79FB\u52A8 ${diff.moved.join("\u3001")}`);
  if (diff.changed.length > 0) parts.push(`\u5B9A\u4E49\u53D8\u5316 ${diff.changed.join("\u3001")}`);
  return parts.join("\uFF1B");
}
var BoardStore = class {
  #root;
  #sessions = /* @__PURE__ */ new Map();
  #waiters = /* @__PURE__ */ new Map();
  /**
   * @param home - Harness home directory.
   */
  constructor(home = process.env.DSH_HOME ?? join(homedir(), ".dsh")) {
    this.#root = join(home, "geogebra", "boards");
  }
  #dir(sessionId) {
    return join(this.#root, encodeURIComponent(sessionId));
  }
  #file(sessionId, boardId) {
    return join(this.#dir(sessionId), `${boardId}.json`);
  }
  /**
   * Monotonic board index for a session. Board ids must never be reused: the
   * conversation node key is the board id, so a reused id would merge a new
   * board into an old (possibly deleted) card.
   */
  #nextIndex(sessionId) {
    const file = join(this.#dir(sessionId), "seq.txt");
    let next = 1;
    try {
      if (existsSync(file)) {
        const parsed = Number(readFileSync(file, "utf8").trim());
        if (Number.isInteger(parsed) && parsed > 0) next = parsed;
      }
    } catch {
    }
    try {
      mkdirSync(this.#dir(sessionId), { recursive: true });
      writeFileSync(file, String(next + 1), "utf8");
    } catch {
    }
    return next;
  }
  #load(sessionId) {
    const cached = this.#sessions.get(sessionId);
    if (cached !== void 0) return cached;
    const boards = /* @__PURE__ */ new Map();
    const dir = this.#dir(sessionId);
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
          if (typeof record.boardId === "string") boards.set(record.boardId, record);
        } catch {
        }
      }
    }
    this.#sessions.set(sessionId, boards);
    return boards;
  }
  #persist(record) {
    try {
      mkdirSync(this.#dir(record.sessionId), { recursive: true });
      const target = this.#file(record.sessionId, record.boardId);
      const temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(record));
      renameSync(temporary, target);
    } catch {
    }
  }
  /** Create one board, allocating the session-local id and a unique name. */
  create(input) {
    const boards = this.#load(input.sessionId);
    if (boards.size >= MAX_BOARDS) throw new Error(`this session already has ${MAX_BOARDS} boards`);
    let index = this.#nextIndex(input.sessionId);
    while (boards.has(`b${index}`)) index += 1;
    const taken = new Set([...boards.values()].map((record2) => record2.name));
    let name2 = input.name.trim() || `\u677F${index}`;
    if (taken.has(name2)) {
      let suffix = 2;
      while (taken.has(`${name2} (${suffix})`)) suffix += 1;
      name2 = `${name2} (${suffix})`;
    }
    const record = {
      boardId: `b${index}`,
      sessionId: input.sessionId,
      name: name2,
      appName: input.appName,
      status: "creating",
      turn: input.turn,
      attempt: 0,
      ...input.caption === void 0 ? {} : { caption: input.caption },
      ...input.baseXml === void 0 ? {} : { baseXml: input.baseXml },
      commands: input.commands,
      failed: [],
      warnings: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    boards.set(record.boardId, record);
    this.#persist(record);
    return record;
  }
  /** Freeze every draft created before `turn`. */
  finalizeBefore(sessionId, turn) {
    const finalized = [];
    for (const record of this.#load(sessionId).values()) {
      if (record.status === "draft" && record.turn < turn) {
        record.status = "final";
        record.updatedAt = Date.now();
        this.#persist(record);
        finalized.push(record.boardId);
      }
    }
    return finalized;
  }
  /**
   * Re-run a draft with new commands on top of its current construction.
   *
   * The base for a re-run is the board's *current* XML, not the original base:
   * the model may resend only the failed commands, and existing objects stay
   * (GeoGebra redefines a label when the full list is resent, which is also
   * fine). Only the current turn may amend; afterwards the board is frozen.
   */
  amend(sessionId, reference, commands, turn, caption) {
    const record = this.get(sessionId, reference);
    if (record === void 0) throw new Error(`board "${reference}" not found`);
    if (record.status === "creating") throw new Error(`${record.boardId} \u5C1A\u672A\u56DE\u586B\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002`);
    if (record.status === "final" || record.turn !== turn) {
      throw new Error(`${record.boardId} \u5DF2\u7ECF\u5B9A\u7A3F\uFF0C\u4E0D\u80FD\u518D\u4FEE\u6539\uFF1B\u8BF7\u57FA\u4E8E\u5B83 geogebra_create \u4E00\u5F20\u65B0\u677F\u3002`);
    }
    if (record.currentXml !== void 0) record.baseXml = record.currentXml;
    if (caption !== void 0 && caption.trim() !== "") record.caption = caption.trim();
    record.commands = commands;
    record.attempt += 1;
    record.status = "creating";
    record.updatedAt = Date.now();
    this.#persist(record);
    return record;
  }
  /** Mark one draft final. */
  commit(sessionId, reference) {
    const record = this.get(sessionId, reference);
    if (record === void 0) throw new Error(`board "${reference}" not found`);
    record.status = "final";
    record.updatedAt = Date.now();
    this.#persist(record);
    return record;
  }
  /** Resolve a board by id or by name. */
  get(sessionId, reference) {
    const boards = this.#load(sessionId);
    const byId = boards.get(reference);
    if (byId !== void 0) return byId;
    for (const record of boards.values()) {
      if (record.name === reference) return record;
    }
    return void 0;
  }
  /** All boards of one session, oldest first. */
  list(sessionId) {
    return [...this.#load(sessionId).values()].sort((left, right) => left.createdAt - right.createdAt);
  }
  /** Card render payload. */
  payload(record) {
    return {
      boardId: record.boardId,
      name: record.name,
      appName: record.appName,
      status: record.status,
      turn: record.turn,
      attempt: record.attempt,
      ...record.caption === void 0 ? {} : { caption: record.caption },
      ...record.baseXml === void 0 ? {} : { baseXml: record.baseXml },
      ...record.currentXml === void 0 ? {} : { currentXml: record.currentXml },
      ...record.originalXml === void 0 ? {} : { originalXml: record.originalXml },
      commands: record.commands
    };
  }
  /** Wait for a board's creation receipt. */
  waitReady(sessionId, boardId, timeoutMs) {
    const record = this.#sessions.get(sessionId)?.get(boardId);
    if (record !== void 0 && record.status !== "creating") return Promise.resolve(record);
    const key = `${sessionId}:${boardId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(void 0), timeoutMs);
      const list = this.#waiters.get(key) ?? [];
      list.push((ready) => {
        clearTimeout(timer);
        resolve(ready);
      });
      this.#waiters.set(key, list);
    });
  }
  /** Apply the creation receipt: original = current = reported XML. */
  receipt(sessionId, boardId, input) {
    const record = this.get(sessionId, boardId);
    if (record === void 0) return void 0;
    const size = input.xml.length + (input.ggbBase64?.length ?? 0) * 2;
    record.originalXml = input.xml;
    record.currentXml = input.xml;
    if (input.ggbBase64 !== void 0) {
      record.originalGgbBase64 = input.ggbBase64;
      record.currentGgbBase64 = input.ggbBase64;
    }
    record.sheet = input.sheet;
    record.originalSheet = input.sheet;
    record.failed = input.failed;
    record.warnings = input.warnings ?? [];
    record.status = "draft";
    record.updatedAt = Date.now();
    if (size > MAX_BOARD_BYTES) record.failed = [...record.failed, { command: "(board too large)", error: "board exceeds the size budget" }];
    this.#persist(record);
    const key = `${sessionId}:${boardId}`;
    for (const resolve of this.#waiters.get(key) ?? []) resolve(record);
    this.#waiters.delete(key);
    return record;
  }
  /** Apply a user edit: current changes, original stays. */
  update(sessionId, boardId, input) {
    const record = this.get(sessionId, boardId);
    if (record === void 0 || record.status === "creating") return void 0;
    record.currentXml = input.xml;
    if (input.ggbBase64 !== void 0) record.currentGgbBase64 = input.ggbBase64;
    record.sheet = input.sheet;
    record.updatedAt = Date.now();
    this.#persist(record);
    return record;
  }
  /** Delete one board and its snapshot file. */
  delete(sessionId, reference) {
    const boards = this.#load(sessionId);
    const record = this.get(sessionId, reference);
    if (record === void 0) return void 0;
    boards.delete(record.boardId);
    try {
      rmSync(this.#file(sessionId, record.boardId), { force: true });
    } catch {
    }
    return record;
  }
  /** Rename a board; the id never changes. */
  rename(sessionId, reference, name2) {
    const record = this.get(sessionId, reference);
    if (record === void 0) return void 0;
    const trimmed = name2.trim();
    if (trimmed === "") throw new Error("the new name must not be empty");
    const boards = this.#load(sessionId);
    for (const other of boards.values()) {
      if (other.boardId !== record.boardId && other.name === trimmed) {
        throw new Error(`another board is already named "${trimmed}"`);
      }
    }
    record.name = trimmed;
    record.updatedAt = Date.now();
    this.#persist(record);
    return record;
  }
};

// src/command-names.json
var command_names_default = {
  source: "https://geogebra.github.io/docs/manual/en/",
  generated: "2026-10-19",
  names: [
    "AffineRatio",
    "Angle",
    "AngleBisector",
    "ANOVA",
    "Append",
    "ApplyMatrix",
    "Arc",
    "Area",
    "AreCollinear",
    "AreConcurrent",
    "AreConcyclic",
    "AreCongruent",
    "AreEqual",
    "AreParallel",
    "ArePerpendicular",
    "Assume",
    "Asymptote",
    "AttachCopyToView",
    "Axes",
    "AxisStepX",
    "AxisStepY",
    "BarChart",
    "Barycenter",
    "Bernoulli",
    "BetaDist",
    "BinomialDist",
    "Bottom",
    "BoxPlot",
    "Button",
    "CASLoaded",
    "Cauchy",
    "Cell",
    "CellRange",
    "Center",
    "CenterView",
    "Centroid",
    "CFactor",
    "CharacteristicPolynomial",
    "Checkbox",
    "ChiSquared",
    "ChiSquaredTest",
    "CIFactor",
    "Circle",
    "CircularArc",
    "CircularSector",
    "CircumcircularArc",
    "CircumcircularSector",
    "Circumference",
    "Classes",
    "ClosestPoint",
    "ClosestPointRegion",
    "Coefficients",
    "Column",
    "ColumnName",
    "CommonDenominator",
    "CompleteSquare",
    "ComplexRoot",
    "Cone",
    "Conic",
    "ConjugateDiameter",
    "ConstructionStep",
    "ContingencyTable",
    "ContinuedFraction",
    "ConvexHull",
    "CopyFreeObject",
    "Corner",
    "CorrelationCoefficient",
    "CountIf",
    "Covariance",
    "Cross",
    "CrossRatio",
    "CSolutions",
    "CSolve",
    "Cube",
    "Cubic",
    "Curvature",
    "CurvatureVector",
    "Curve",
    "Cylinder",
    "DataFunction",
    "Degree",
    "DelaunayTriangulation",
    "Delete",
    "Denominator",
    "Derivative",
    "Determinant",
    "Difference",
    "Dimension",
    "Direction",
    "Directrix",
    "Distance",
    "Div",
    "Division",
    "Divisors",
    "DivisorsList",
    "DivisorsSum",
    "Dodecahedron",
    "Dot",
    "DotPlot",
    "DynamicCoordinates",
    "Eccentricity",
    "Eigenvalues",
    "Eigenvectors",
    "Element",
    "Eliminate",
    "Ellipse",
    "Ends",
    "Envelope",
    "Erlang",
    "Execute",
    "Expand",
    "Exponential",
    "ExportImage",
    "ExtendedGCD",
    "Extremum",
    "Factor",
    "Factors",
    "FDistribution",
    "FillCells",
    "FillColumn",
    "FillRow",
    "First",
    "Fit",
    "FitExp",
    "FitGrowth",
    "FitImplicit",
    "FitLine",
    "FitLineX",
    "FitLog",
    "FitLogistic",
    "FitPoly",
    "FitPow",
    "FitSin",
    "Flatten",
    "Focus",
    "FormulaText",
    "FractionText",
    "Frequency",
    "FrequencyPolygon",
    "FrequencyTable",
    "FromBase",
    "Function",
    "FutureValue",
    "Gamma",
    "GCD",
    "GeometricMean",
    "GetTime",
    "GroebnerDegRevLex",
    "GroebnerLex",
    "GroebnerLexDeg",
    "HarmonicMean",
    "Height",
    "HideLayer",
    "Histogram",
    "HistogramRight",
    "Hyperbola",
    "HyperGeometric",
    "Icosahedron",
    "Identity",
    "If",
    "IFactor",
    "ImplicitCurve",
    "ImplicitDerivative",
    "Incircle",
    "IndexOf",
    "InfiniteCone",
    "InfiniteCylinder",
    "InflectionPoint",
    "InputBox",
    "Insert",
    "Integral",
    "IntegralBetween",
    "IntegralSymbolic",
    "InteriorAngles",
    "Intersect",
    "IntersectConic",
    "Intersection",
    "IntersectPath",
    "InverseBeta",
    "InverseBinomial",
    "InverseBinomialMinimumTrials",
    "InverseCauchy",
    "InverseChiSquared",
    "InverseExponential",
    "InverseFDistribution",
    "InverseGamma",
    "InverseHyperGeometric",
    "InverseLaplace",
    "InverseLogistic",
    "InverseLogNormal",
    "InverseNormal",
    "InversePascal",
    "InversePoisson",
    "InverseTDistribution",
    "InverseWeibull",
    "InverseZipf",
    "Invert",
    "IsDefined",
    "IsFactored",
    "IsInRegion",
    "IsInteger",
    "IsPrime",
    "IsTangent",
    "IsVertexForm",
    "Iteration",
    "IterationList",
    "Join",
    "JordanDiagonalization",
    "KeepIf",
    "Laplace",
    "Last",
    "LCM",
    "LeftSide",
    "LeftSum",
    "Length",
    "LetterToUnicode",
    "Limit",
    "LimitAbove",
    "LimitBelow",
    "Line",
    "LinearEccentricity",
    "LineGraph",
    "Locus",
    "LocusEquation",
    "Logistic",
    "LogNormal",
    "LowerSum",
    "LUDecomposition",
    "MAD",
    "MajorAxis",
    "MatrixRank",
    "Max",
    "Maximize",
    "Mean",
    "MeanX",
    "MeanY",
    "Median",
    "Midpoint",
    "Min",
    "MinimalPolynomial",
    "Minimize",
    "MinimumSpanningTree",
    "MinorAxis",
    "MixedNumber",
    "Mod",
    "Mode",
    "ModularExponent",
    "Name",
    "NDerivative",
    "Net",
    "NextPrime",
    "NIntegral",
    "NInvert",
    "Normal",
    "Normalize",
    "NormalQuantilePlot",
    "NSolutions",
    "NSolve",
    "NSolveODE",
    "Numerator",
    "Numeric",
    "Object",
    "Octahedron",
    "Ordinal",
    "OrdinalRank",
    "OsculatingCircle",
    "Pan",
    "Parabola",
    "Parameter",
    "ParametricDerivative",
    "ParseToFunction",
    "ParseToNumber",
    "PartialFractions",
    "Pascal",
    "PathParameter",
    "Payment",
    "Percentile",
    "Perimeter",
    "Periods",
    "PerpendicularBisector",
    "PerpendicularLine",
    "PerpendicularPlane",
    "PerpendicularVector",
    "PieChart",
    "Plane",
    "PlaneBisector",
    "PlaySound",
    "PlotSolve",
    "Point",
    "PointIn",
    "PointList",
    "Poisson",
    "Polar",
    "Polygon",
    "Polyline",
    "Polynomial",
    "PresentValue",
    "PreviousPrime",
    "PrimeFactors",
    "Prism",
    "Product",
    "Prove",
    "ProveDetails",
    "Pyramid",
    "QRDecomposition",
    "Quartile1",
    "Quartile3",
    "Radius",
    "RandomBetween",
    "RandomBinomial",
    "RandomDiscrete",
    "RandomElement",
    "RandomNormal",
    "RandomPointIn",
    "RandomPoisson",
    "RandomPolynomial",
    "RandomUniform",
    "Rate",
    "Rationalize",
    "Ray",
    "ReadText",
    "RectangleSum",
    "ReducedRowEchelonForm",
    "Reflect",
    "Relation",
    "RemovableDiscontinuity",
    "Remove",
    "RemoveUndefined",
    "Rename",
    "Repeat",
    "ReplaceAll",
    "ResidualPlot",
    "Reverse",
    "RightSide",
    "RigidPolygon",
    "Root",
    "RootList",
    "RootMeanSquare",
    "Roots",
    "Rotate",
    "RotateText",
    "Row",
    "RSquare",
    "RunClickScript",
    "RunUpdateScript",
    "Sample",
    "SampleSD",
    "SampleSDX",
    "SampleSDY",
    "SampleVariance",
    "ScientificText",
    "SD",
    "SDX",
    "SDY",
    "Sector",
    "Segment",
    "SelectedElement",
    "SelectedIndex",
    "SelectObjects",
    "Semicircle",
    "SemiMajorAxisLength",
    "SemiMinorAxisLength",
    "Sequence",
    "SetActiveView",
    "SetAxesRatio",
    "SetBackgroundColor",
    "SetCaption",
    "SetColor",
    "SetConditionToShowObject",
    "SetConstructionStep",
    "SetCoords",
    "SetDecoration",
    "SetDynamicColor",
    "SetFilling",
    "SetFixed",
    "SetImage",
    "SetLabelMode",
    "SetLayer",
    "SetLevelOfDetail",
    "SetLineOpacity",
    "SetLineStyle",
    "SetLineThickness",
    "SetPerspective",
    "SetPointSize",
    "SetPointStyle",
    "SetSeed",
    "SetSpinSpeed",
    "SetTooltipMode",
    "SetTrace",
    "SetValue",
    "SetViewDirection",
    "SetVisibleInView",
    "Shear",
    "ShortestDistance",
    "ShowAxes",
    "ShowGrid",
    "ShowLabel",
    "ShowLayer",
    "Shuffle",
    "Side",
    "SigmaXX",
    "SigmaXY",
    "SigmaYY",
    "Simplify",
    "Slider",
    "Slope",
    "SlopeField",
    "SlowPlot",
    "Solutions",
    "Solve",
    "SolveCubic",
    "SolveODE",
    "SolveQuartic",
    "Sort",
    "Spearman",
    "Sphere",
    "Spline",
    "Split",
    "StartAnimation",
    "StartRecord",
    "StemPlot",
    "StepGraph",
    "StickGraph",
    "Stretch",
    "Substitute",
    "Sum",
    "SumSquaredErrors",
    "SurdText",
    "Surface",
    "SVD",
    "Sxx",
    "Sxy",
    "Syy",
    "TableText",
    "Take",
    "Tangent",
    "TaylorPolynomial",
    "TDistribution",
    "Tetrahedron",
    "Text",
    "TextToUnicode",
    "TiedRank",
    "TMean2Estimate",
    "TMeanEstimate",
    "ToBase",
    "ToComplex",
    "ToExponential",
    "ToolImage",
    "Top",
    "ToPoint",
    "ToPolar",
    "Translate",
    "Transpose",
    "TrapezoidalSum",
    "TravelingSalesman",
    "TriangleCenter",
    "TriangleCurve",
    "Triangular",
    "TrigCombine",
    "TrigExpand",
    "TrigSimplify",
    "Trilinear",
    "TTest",
    "TTest2",
    "TTestPaired",
    "Turtle",
    "TurtleBack",
    "TurtleDown",
    "TurtleForward",
    "TurtleLeft",
    "TurtleRight",
    "TurtleUp",
    "Type",
    "UnicodeToLetter",
    "UnicodeToText",
    "Uniform",
    "Union",
    "Unique",
    "UnitPerpendicularVector",
    "UnitVector",
    "UpdateConstruction",
    "UpperSum",
    "Variance",
    "Vector",
    "Vertex",
    "VerticalText",
    "Volume",
    "Voronoi",
    "Weibull",
    "Zip",
    "Zipf",
    "ZMean2Estimate",
    "ZMean2Test",
    "ZMeanEstimate",
    "ZMeanTest",
    "ZoomIn",
    "ZoomOut",
    "ZProportion2Estimate",
    "ZProportion2Test",
    "ZProportionEstimate",
    "ZProportionTest"
  ]
};

// src/command-lint.ts
var NAMES = command_names_default.names;
var KNOWN = new Set(NAMES);
function distance(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[columns - 1];
}
function suggest(name2) {
  if (name2.length < 3) return void 0;
  let best;
  let bestDistance = 3;
  for (const candidate of NAMES) {
    if (Math.abs(candidate.length - name2.length) > 2) continue;
    const value = distance(name2, candidate);
    if (value < bestDistance) {
      bestDistance = value;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : void 0;
}
function candidates(line) {
  const found = [];
  const pattern = /\b([A-Z][A-Za-z0-9]*)\s*[([\]]/g;
  let match;
  while ((match = pattern.exec(line)) !== null) found.push(match[1]);
  return found;
}
function lintCommands(commands) {
  const issues = /* @__PURE__ */ new Map();
  for (const line of commands) {
    for (const name2 of candidates(line)) {
      if (KNOWN.has(name2)) continue;
      const suggestion = suggest(name2);
      if (suggestion === void 0) continue;
      if (!issues.has(name2)) issues.set(name2, { command: line, unknown: name2, suggestion });
    }
  }
  return [...issues.values()];
}
var COMMAND_COUNT = NAMES.length;
function findWhiteColors(commands) {
  const hits = [];
  for (const line of commands) {
    const named = /SetColor\s*\(\s*[^,)]+\s*,\s*["']?(white|白)["']?\s*\)/i.test(line);
    const rgb = /SetColor\s*\(\s*[^,)]+\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(line);
    const nearWhite = rgb !== null && Number(rgb[1]) >= 230 && Number(rgb[2]) >= 230 && Number(rgb[3]) >= 230;
    const hex = /#[fF]{6}\b|#[fF]{3}\b/.test(line);
    if (named || nearWhite || hex) hits.push(line);
  }
  return hits;
}

// src/modes.ts
var MODES = [
  {
    id: "suite",
    label: "Suite",
    summary: "Modern full app: algebra, graphics, CAS, spreadsheet and 3D in one window. Best default for mixed work.",
    examples: ["f(x)=x^2", "A=(1,2)", "c=Circle(A,3)"]
  },
  {
    id: "classic",
    label: "Classic",
    summary: "Older full UI with a menu bar. Same command coverage as suite, classic look.",
    examples: ["A=(0,0)", "B=(2,0)", "Polygon(A,B,4)"]
  },
  {
    id: "graphing",
    label: "Graphing",
    summary: "Function graphing. Geometry commands such as Segment, Distance or Circle are not available.",
    examples: ["f(x)=x^2-4x+3", "V=Extremum(f)", "R=Root(f)"]
  },
  {
    id: "geometry",
    label: "Geometry",
    summary: "Geometric constructions: points, lines, circles, polygons, intersections, transformations.",
    examples: ["A=(0,0)", "B=(2,0)", "c=Circle(A,B)", "d=PerpendicularLine(B,c)"]
  },
  {
    id: "3d",
    label: "3D",
    summary: "3D view and solids. Use uppercase points; a lowercase label becomes a vector.",
    examples: ["A=(0,0,0)", "B=(2,0,0)", "C=(2,2,0)", "cube=Cube(A,B,C)", "Sphere((0,0,0),2)"],
    note: "3D uses the T/AT perspective; charts are drawn in the 3D view."
  },
  {
    id: "scientific",
    label: "Scientific",
    summary: "Scientific calculator for numeric work. Not for constructions.",
    examples: ["sin(30\xB0)", "2^10"]
  },
  {
    id: "evaluator",
    label: "Evaluator",
    summary: "Quick numeric evaluation. Not for constructions.",
    examples: ["1/3+1/4"]
  },
  {
    id: "notes",
    label: "Notes",
    summary: "Notes/documents. Not a construction app.",
    examples: []
  }
];
function modeNote(appName) {
  if (appName !== "3d") return "";
  return "\u6A21\u5F0F\uFF1A3D\uFF08\u5927\u5199\u70B9\uFF0C\u4F8B\u5982 A=(0,0,0)\uFF1B\u5C0F\u5199\u6807\u7B7E\u4F1A\u88AB\u5F53\u6210\u5411\u91CF\uFF09\u3002";
}
function catalogText() {
  return MODES.map((mode) => `${mode.id} \u2014 ${mode.summary}`).join("\n");
}
function modeText(appName) {
  const mode = MODES.find((item) => item.id === appName);
  if (mode === void 0) return "";
  const lines = [`${mode.id} (${mode.label}): ${mode.summary}`];
  if (mode.examples.length > 0) lines.push(`\u793A\u4F8B\uFF1A${mode.examples.join("\uFF1B")}`);
  if (mode.note !== void 0) lines.push(mode.note);
  return lines.join("\n");
}

// src/index.ts
var name = "dsh-geogebra-chat";
var inject = ["tools", "sessionProjections", "connection", "systemPrompt"];
var BOARD_RECORD = "plugin:dsh-geogebra-chat/board";
var PROMPT_ORDER = 3200;
var PROMPT_TEXT = `## GeoGebra \u753B\u677F

\u7528 geogebra_create \u4F5C\u56FE\uFF0C\u5FC5\u987B\u8D77\u4E00\u4E2A\u77ED\u540D\u5B57\uFF084\u201312 \u5B57\uFF0C\u4F1A\u8BDD\u5185\u552F\u4E00\uFF09\u3002

**\u7528\u6237\u8981\u4EC0\u4E48\u5C31\u753B\u4EC0\u4E48\u3002** \u4E00\u6761\u547D\u4EE4\u80FD\u5B8C\u6210\u5C31\u522B\u62C6\u6210\u591A\u6761\uFF1B\u4E0D\u8981\u81EA\u884C\u6DFB\u52A0\u6ED1\u5757\u3001\u8F85\u52A9\u70B9\u3001\u6807\u6CE8\u3001\u4EA4\u70B9\u3001\u7F29\u653E\u6216\u89C6\u56FE\u8C03\u6574\uFF0C\u9664\u975E\u9898\u76EE\u672C\u6765\u5C31\u9700\u8981\u52A8\u70B9\uFF08\u8FD9\u65F6\u7528\u53C2\u6570\u6216\u4F9D\u8D56\u5BF9\u8C61\uFF09\u3002**\u4E0D\u8981\u6539\u989C\u8272\u3001\u7EBF\u5BBD\u3001\u70B9\u5927\u5C0F**\uFF1B\u5C24\u5176\u4E0D\u8981\u628A\u4EFB\u4F55\u5BF9\u8C61\u8BBE\u6210\u767D\u8272\u6216\u6D45\u8272\u2014\u2014\u767D\u5E95\u4E0A\u4F1A\u5B8C\u5168\u770B\u4E0D\u89C1\u3002\u9ED8\u8BA4\u6837\u5F0F\u5C31\u5F88\u597D\u3002

**\u6784\u9020\u8981\u80FD\u62D6\u52A8\u3002** \u9898\u76EE\u8BF4"\u70B9 P \u5728\u629B\u7269\u7EBF/\u5706/\u7EBF\u6BB5\u4E0A"\u65F6\uFF0CP \u5FC5\u987B\u4F9D\u8D56\u90A3\u4E2A\u5BF9\u8C61\uFF0C\u4E0D\u80FD\u5199\u6210\u56FA\u5B9A\u5750\u6807\uFF1A
- \u70B9\u5728\u66F2\u7EBF\u4E0A\uFF1A\u7528 P=Point(f)\uFF1B\u9700\u8981\u63A7\u5236\u4F4D\u7F6E\u65F6\u7528 t=Slider(0,5,0.1) \u52A0 P=(t,f(t))\uFF0C\u4E0D\u8981\u5199\u6B7B\u518D\u624B\u52A8\u632A\uFF1B
- \u4EA4\u70B9\u7528 Intersect\uFF0C\u4E2D\u70B9\u7528 Midpoint\uFF0C\u5782\u8DB3\u7528 ClosestPoint \u6216 PerpendicularLine\uFF1B
- \u53EA\u6709\u9898\u76EE\u5141\u8BB8\u81EA\u7531\u70B9\u65F6\u624D\u5199 A=(1,2)\u3002

\u63D0\u4EA4\u524D\u81EA\u68C0\uFF1A\u62D6\u52A8\u6BCF\u4E2A\u52A8\u70B9\uFF0C\u5B83\u662F\u5426\u4ECD\u6EE1\u8DB3\u9898\u8BBE\uFF1B\u4E0D\u6EE1\u8DB3\u5C31\u6539\u6210\u4F9D\u8D56\u6784\u9020\uFF0C\u522B\u7B49\u7528\u6237\u6765\u95EE\u3002

\u65E7\u677F\u4E0D\u53EF\u4FEE\u6539\uFF1A\u60F3\u63A5\u7740\u753B\uFF0C\u5148 geogebra_check \u770B\u7528\u6237\u6539\u4E86\u4EC0\u4E48\uFF0C\u518D\u7528 geogebra_create \u7684 from \u57FA\u4E8E\u5B83\u751F\u6210\u65B0\u677F\u3002\u547D\u4EE4\u5931\u8D25\u65F6\u7528 geogebra_amend \u5728\u540C\u4E00\u4E2A\u56DE\u5408\u4FEE\u6B63\uFF08\u53EA\u9700\u91CD\u53D1\u5931\u8D25\u7684\u90A3\u51E0\u6761\uFF0C\u5DF2\u6709\u5BF9\u8C61\u4F1A\u4FDD\u7559\uFF1B\u53D1\u5B8C\u6574\u5217\u8868\u4E5F\u53EF\u4EE5\uFF09\uFF1B\u56DE\u5408\u7ED3\u675F\u540E\u677F\u4F1A\u51BB\u7ED3\u3002

\u9ED8\u8BA4\u7528 suite\uFF08\u65B0\u7248\u754C\u9762\uFF0C\u6307\u4EE4\u6700\u5168\uFF09\u3002\u53EA\u6709\u7528\u6237\u660E\u786E\u8981"\u51FD\u6570\u56FE\u5F62\u8BA1\u7B97\u5668"\u3001\u4E14\u5185\u5BB9\u53EA\u662F\u51FD\u6570\u66F2\u7EBF\u65F6\u624D\u7528 graphing\uFF1Bevaluator\u3001scientific\u3001notes \u6309\u9700\u3002

\u4E00\u6B21 create \u6210\u529F\u540E\u5C31\u5411\u7528\u6237\u6C47\u62A5\u753B\u4E86\u4EC0\u4E48\uFF0C\u4E0D\u8981\u518D\u8C03\u7528 inspect\u3001list \u6216 check\uFF0C\u9664\u975E\u9700\u8981\u5177\u4F53\u6570\u503C\u3001\u627E\u65E7\u677F\u3001\u6216\u51C6\u5907\u57FA\u4E8E\u65E7\u677F\u7EE7\u7EED\u3002**\u8FB9\u8BB2\u8FB9\u753B**\uFF1A\u50CF\u8BB2\u6570\u5B66\u9898\u4E00\u6837\uFF0C\u5148\u753B\u4E00\u79CD\u60C5\u51B5\u3001\u7528\u6B63\u6587\u8BB2\u89E3\uFF0C\u518D\u753B\u4E0B\u4E00\u79CD\u60C5\u51B5\u518D\u8BB2\u89E3\uFF1B\u56FE\u548C\u6587\u5B57\u4EA4\u66FF\u51FA\u73B0\uFF0C\u522B\u8BA9\u7528\u6237\u5BF9\u7740\u4E00\u5806\u56FE\u731C\u3002\u662F\u5426\u5206\u6BB5\u3001\u6BCF\u6BB5\u591A\u957F\u7531\u4F60\u5224\u65AD\uFF0C\u7B80\u5355\u4F5C\u56FE\u4E0D\u5FC5\u5F3A\u884C\u63D2\u8BDD\u3002caption \u53EF\u9009\uFF0C\u4E0D\u8981\u6BCF\u5F20\u90FD\u5199\u3002\u53EA\u6709\u7528\u6237\u660E\u786E\u8981\u6C42\u65F6\u624D\u5220\u9664\u753B\u677F\uFF08geogebra_delete\uFF09\uFF0C\u4E0D\u8981\u4E3B\u52A8\u5220\u3002\u4E0D\u786E\u5B9A\u7528\u54EA\u4E2A app \u6A21\u5F0F\u65F6\u8C03\u7528 geogebra_modes\uFF1B**\u6BCF\u6B21 create \u90FD\u5FC5\u987B\u663E\u5F0F\u4F20 appName**\uFF083D \u7528 3d\uFF0C\u7EAF\u51FD\u6570\u7528 graphing\uFF0C\u51E0\u4F55\u7528 geometry \u6216 suite\uFF09\u3002`;
function commandLines(commands) {
  if (typeof commands !== "string") return [];
  return commands.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}
function dshHome() {
  return process.env.DSH_HOME ?? join2(homedir2(), ".dsh");
}
function apply(ctx) {
  const store = new BoardStore(dshHome());
  ctx.systemPrompt.section({ name: "dsh-geogebra-chat:workflow", order: PROMPT_ORDER, text: PROMPT_TEXT });
  const registerRoute = (endpoint, handler) => {
    ctx.effect(() => {
      let dispose;
      void ctx.connection.fetch.register({
        path: `/api/geogebra/board/${endpoint}`,
        methods: ["POST"],
        requestBody: "buffered",
        async fetch(request) {
          let envelope;
          try {
            envelope = await request.json();
          } catch {
            return new Response("body is not JSON", { status: 400 });
          }
          const rpcId = envelope.rpcId;
          if (typeof rpcId !== "string" || envelope.method !== `geogebra/board/${endpoint}`) {
            return new Response("invalid Connection RPC envelope", { status: 400 });
          }
          try {
            const value = await handler(envelope.payload ?? {});
            return Response.json({ type: "server-response", rpcId, result: { ok: true, value } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Response.json({
              type: "server-response",
              rpcId,
              result: { ok: false, error: { code: "GEOGEBRA", message, details: {} } }
            });
          }
        }
      }).then((value) => {
        dispose = value;
      });
      return () => {
        void dispose?.();
      };
    }, `dsh-geogebra-chat: route ${endpoint}`);
  };
  registerRoute("get", (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const boardId = String(payload.boardId ?? "");
    const record = store.get(sessionId, boardId);
    if (record === void 0) throw new Error(`board "${boardId}" not found`);
    return store.payload(record);
  });
  registerRoute("receipt", (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const boardId = String(payload.boardId ?? "");
    if (typeof payload.xml !== "string") throw new Error("receipt requires xml");
    const record = store.receipt(sessionId, boardId, {
      xml: payload.xml,
      ggbBase64: typeof payload.ggbBase64 === "string" ? payload.ggbBase64 : void 0,
      sheet: Array.isArray(payload.sheet) ? payload.sheet : [],
      failed: Array.isArray(payload.failed) ? payload.failed : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : []
    });
    if (record === void 0) throw new Error(`board "${boardId}" not found`);
    return { boardId, status: record.status };
  });
  registerRoute("update", (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const boardId = String(payload.boardId ?? "");
    if (typeof payload.xml !== "string") throw new Error("update requires xml");
    const record = store.update(sessionId, boardId, {
      xml: payload.xml,
      ggbBase64: typeof payload.ggbBase64 === "string" ? payload.ggbBase64 : void 0,
      sheet: Array.isArray(payload.sheet) ? payload.sheet : []
    });
    if (record === void 0) throw new Error("board is not ready");
    return { boardId, updatedAt: record.updatedAt };
  });
  registerRoute("delete", (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const boardId = String(payload.boardId ?? "");
    const removed = store.delete(sessionId, boardId);
    if (removed === void 0) throw new Error(`board "${boardId}" not found`);
    return { deleted: removed.boardId };
  });
  const resolve = (sessionId, reference) => {
    const record = store.get(sessionId, String(reference ?? ""));
    if (record === void 0) {
      const names = store.list(sessionId).map((item) => `${item.boardId}\u300C${item.name}\u300D`).join("\u3001");
      throw new Error(`board "${String(reference ?? "")}" not found. Known boards: ${names || "(none)"}`);
    }
    return record;
  };
  const currentTurn = (session) => ctx.sessionProjections.stateOf(session, "turnBoundary")?.lastTurn ?? 0;
  const failureLines = (failed) => {
    if (failed.length === 0) return [];
    const lines = [`${failed.length} \u6761\u547D\u4EE4\u5931\u8D25\uFF1A`];
    for (const failure of failed) {
      lines.push(`  ${failure.command}${failure.error === void 0 ? "" : ` \u2014 ${failure.error}`}`);
    }
    return lines;
  };
  const warningLines = (warnings) => {
    if (warnings.length === 0) return [];
    const lines = [`\u6CE8\u610F\uFF1A${warnings.length} \u6761\u547D\u4EE4\u8FD4\u56DE false \u4F46\u6CA1\u6709\u62A5\u9519\uFF0C\u53EF\u80FD\u5DF2\u751F\u6548\uFF08\u4E0D\u8981\u91CD\u53D1\uFF09\uFF1A`];
    for (const warning of warnings) lines.push(`  ${warning.command}`);
    return lines;
  };
  const freePointHint = (sheet) => {
    if (sheet === void 0 || sheet.length === 0) return "";
    const hasCurve = sheet.some((entry) => entry.type === "function" || entry.type === "conic" || entry.type === "line");
    if (!hasCurve) return "";
    const suspects = sheet.filter((entry) => entry.type === "point" && entry.x !== void 0 && /^(P|Q|M|N|R|S|T)$/.test(entry.label));
    if (suspects.length === 0) return "";
    return `\u6CE8\u610F\uFF1A${suspects.map((entry) => entry.label).join("\u3001")} \u662F\u81EA\u7531\u70B9\uFF0C\u62D6\u52A8\u4F1A\u8131\u79BB\u66F2\u7EBF\u3002\u82E5\u9898\u76EE\u8981\u6C42\u5B83\u5728\u67D0\u6761\u66F2\u7EBF/\u7EBF\u4E0A\uFF0C\u8BF7\u6539\u6210 Point(f) \u6216 t=Slider(...)+P=(t,f(t))\uFF0C\u7528 geogebra_amend \u4FEE\u6B63\u3002`;
  };
  const lintOrThrow = (commands) => {
    const white = findWhiteColors(commands);
    if (white.length > 0) {
      throw new Error(
        "\u68C0\u6D4B\u5230\u767D\u8272/\u8FD1\u767D\u8272\u5BF9\u8C61\uFF08\u767D\u5E95\u4E0A\u770B\u4E0D\u89C1\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C\uFF08\u4E0D\u4F1A\u521B\u5EFA/\u4FEE\u6539\u753B\u677F\uFF09\uFF1A\n  " + white.join("\n  ") + "\n\u8BF7\u7528\u9ED8\u8BA4\u989C\u8272\u6216\u6DF1\u8272\uFF1B\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\uFF0C\u4E0D\u8981\u6539\u989C\u8272\u3002"
      );
    }
    const issues = lintCommands(commands);
    if (issues.length === 0) return;
    const lines = ["\u6307\u4EE4\u540D\u53EF\u80FD\u6709\u8BEF\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C\uFF08\u4E0D\u4F1A\u521B\u5EFA/\u4FEE\u6539\u753B\u677F\uFF09\uFF1A"];
    for (const issue of issues) {
      const docs = issue.suggestion === void 0 ? "" : `\uFF08\u6587\u6863\uFF1Ahttps://geogebra.github.io/docs/manual/en/commands/${issue.suggestion}/\uFF09`;
      lines.push(`  ${issue.unknown} \u2192 \u6700\u63A5\u8FD1 ${issue.suggestion}${docs}`);
    }
    throw new Error(lines.join("\n"));
  };
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_create",
    description: "Create a new immutable GeoGebra board and return its full construction sheet. Pass `from` to start from an existing board; the Agent never modifies an existing board. Always give the board a short name. Keep the construction minimal: draw only what the user asked for, with default styling, no extra sliders, labels, intersections, colors or zooming unless requested. If commands fail, fix them with geogebra_amend in the same turn instead of creating another board.",
    parameters: {
      type: "object",
      required: ["name", "appName"],
      properties: {
        name: { type: "string", description: "Short board name (4-12 chars), unique in this session." },
        caption: { type: "string", description: "Optional one-line summary shown on the card; omit unless useful." },
        commands: { type: "string", description: "GeoGebra input-bar commands, one per line, executed in order." },
        from: { type: "string", description: "Existing board id or name to use as the base construction." },
        as: { type: "string", enum: ["current", "original"], description: "Which version of `from` to use (default current)." },
        appName: { type: "string", description: "Required. suite, classic, graphing, geometry, 3d, scientific, evaluator, notes. Pick the mode before creating; call geogebra_modes if unsure." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_create requires an agent session");
      const turn = currentTurn(session);
      store.finalizeBefore(session.id, turn);
      const requestedName = String(args.name ?? "").trim();
      if (requestedName === "") throw new Error("geogebra_create requires a short board name");
      let from;
      let baseXml;
      if (args.from !== void 0 && args.from !== "") {
        from = resolve(session.id, args.from);
        if (from.status === "creating") throw new Error(`${from.boardId} \u5C1A\u672A\u56DE\u586B\uFF0C\u6682\u4E0D\u80FD\u4F5C\u4E3A\u5E95\u7A3F\u3002\u7B49\u56DE\u6267\u5B8C\u6210\u540E\u518D\u8BD5\u3002`);
        const useOriginal = args.as === "original";
        baseXml = useOriginal ? from.originalXml : from.currentXml;
        if (baseXml === void 0) throw new Error(`${from.boardId} has no saved XML to use as a base`);
      }
      const commands = commandLines(args.commands);
      lintOrThrow(commands);
      const appName = typeof args.appName === "string" ? args.appName.trim() : "";
      if (appName === "") {
        throw new Error("geogebra_create requires an explicit appName: suite, classic, graphing, geometry, 3d, scientific, evaluator, notes. Call geogebra_modes if unsure.");
      }
      const record = store.create({
        sessionId: session.id,
        name: requestedName,
        appName,
        caption: typeof args.caption === "string" ? args.caption : void 0,
        baseXml,
        commands,
        turn
      });
      appendPluginRecord(session, BOARD_RECORD, {
        boardId: record.boardId,
        name: record.name,
        turn,
        at: Date.now()
      });
      const ready = await store.waitReady(session.id, record.boardId, 8e3);
      if (ready === void 0) {
        return `${record.boardId}\u300C${record.name}\u300D\u5DF2\u521B\u5EFA\uFF08\u72B6\u6001\u5F85\u56DE\u586B\uFF09\u3002\u56DE\u6267\u5230\u8FBE\u540E\u4F1A\u81EA\u52A8\u8865\u5168\uFF1B\u8865\u5168\u524D inspect/check \u4F1A\u63D0\u793A"\u5C1A\u672A\u56DE\u586B"\u3002`;
      }
      const parts = [];
      const changed = from === void 0 ? "" : diffText(from.originalSheet, from.sheet);
      const base = from === void 0 ? "" : `\uFF0C\u57FA\u4E8E ${from.boardId}\u300C${from.name}\u300D${changed === "" ? "" : `\uFF08\u7528\u6237\u6539\u8FC7\uFF1A${changed}\uFF09`}`;
      parts.push(`${record.boardId}\u300C${record.name}\u300D\u5DF2\u521B\u5EFA${base}\uFF1A`);
      const note = modeNote(appName);
      if (note !== "") parts.push(note);
      parts.push(sheetText(ready.sheet));
      const added = diffText(from?.sheet, ready.sheet);
      if (added !== "") parts.push(`\u672C\u6B21\u65B0\u589E\uFF1A${added}`);
      const pointHint = freePointHint(ready.sheet);
      if (pointHint !== "") parts.push(pointHint);
      if (ready.failed.length > 0) {
        parts.push(...failureLines(ready.failed));
        parts.push("\uFF08\u4FEE\u6B63\u8BF7\u7528 geogebra_amend\uFF0C\u4E0D\u8981\u4E3A\u540C\u6837\u7684\u5185\u5BB9\u518D\u65B0\u5EFA\u677F\u3002\uFF09");
      }
      if (ready.warnings.length > 0) parts.push(...warningLines(ready.warnings));
      return parts.join("\n");
    }
  }), "dsh-geogebra-chat: create");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_amend",
    description: "Fix a board created in the current turn: run new commands on top of its current construction. Resend only the failed commands (existing objects are kept); sending the full list also works because GeoGebra redefines labels. Only the current turn may amend; after the turn the board is frozen.",
    parameters: {
      type: "object",
      required: ["board"],
      properties: {
        board: { type: "string", description: "Board id or name." },
        commands: { type: "string", description: "Replacement command list, one per line." },
        caption: { type: "string", description: "Optional updated one-line description shown on the card." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_amend requires an agent session");
      const turn = currentTurn(session);
      store.finalizeBefore(session.id, turn);
      const record = resolve(session.id, args.board);
      const commands = commandLines(args.commands);
      lintOrThrow(commands);
      store.amend(session.id, record.boardId, commands, turn, typeof args.caption === "string" ? args.caption : void 0);
      const ready = await store.waitReady(session.id, record.boardId, 8e3);
      if (ready === void 0) return `${record.boardId} \u5DF2\u91CD\u65B0\u63D0\u4EA4\uFF08\u72B6\u6001\u5F85\u56DE\u586B\uFF09\u3002`;
      const parts = [`${record.boardId}\u300C${record.name}\u300D\u5DF2\u91CD\u65B0\u751F\u6210\uFF1A`, sheetText(ready.sheet)];
      if (ready.failed.length > 0) parts.push(...failureLines(ready.failed));
      const pointHint = freePointHint(ready.sheet);
      if (pointHint !== "") parts.push(pointHint);
      return parts.join("\n");
    }
  }), "dsh-geogebra-chat: amend");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_commit",
    description: "Freeze a board immediately. Boards are frozen automatically when the turn ends, so this is only needed to freeze early.",
    parameters: {
      type: "object",
      required: ["board"],
      properties: {
        board: { type: "string", description: "Board id or name." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_commit requires an agent session");
      const record = resolve(session.id, args.board);
      store.commit(session.id, record.boardId);
      return `${record.boardId}\u300C${record.name}\u300D\u5DF2\u5B9A\u7A3F\u3002`;
    }
  }), "dsh-geogebra-chat: commit");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_check",
    description: "Report whether an existing board was edited by the user since the Agent created it, and what changed. Call this before creating a board from an old one.",
    parameters: {
      type: "object",
      required: ["board"],
      properties: {
        board: { type: "string", description: "Board id or name." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_check requires an agent session");
      store.finalizeBefore(session.id, currentTurn(session));
      const record = resolve(session.id, args.board);
      if (record.status === "creating") return `${record.boardId} \u5C1A\u672A\u56DE\u586B\uFF08\u753B\u677F\u8FD8\u6CA1\u52A0\u8F7D\u5B8C\u6210\uFF09\u3002\u7A0D\u540E\u518D\u8BD5\uFF0C\u6216\u7528 geogebra_list \u67E5\u770B\u72B6\u6001\u3002`;
      const changed = diffText(record.originalSheet, record.sheet);
      if (changed === "") return `${record.boardId}\u300C${record.name}\u300D\u672A\u88AB\u4FEE\u6539\u3002`;
      return `${record.boardId}\u300C${record.name}\u300D\u88AB\u4FEE\u6539\uFF1A${changed}\u3002
\u5F53\u524D\u6E05\u5355\uFF1A${sheetText(record.sheet)}`;
    }
  }), "dsh-geogebra-chat: check");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_inspect",
    description: "Read the construction sheet of a board, or one object's definition and value.",
    parameters: {
      type: "object",
      properties: {
        board: { type: "string", description: "Board id or name." },
        name: { type: "string", description: "Object label; omit to read the whole sheet." },
        detail: { type: "string", enum: ["definition", "value"], description: "What to report for one object." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_inspect requires an agent session");
      store.finalizeBefore(session.id, currentTurn(session));
      const record = resolve(session.id, args.board);
      if (record.status === "creating") return `${record.boardId} \u5C1A\u672A\u56DE\u586B\uFF08\u753B\u677F\u8FD8\u6CA1\u52A0\u8F7D\u5B8C\u6210\uFF09\u3002\u7A0D\u540E\u518D\u8BD5\uFF0C\u6216\u7528 geogebra_list \u67E5\u770B\u72B6\u6001\u3002`;
      const sheet = record.sheet ?? [];
      const label = typeof args.name === "string" ? args.name : "";
      if (label === "") return `${record.boardId}\u300C${record.name}\u300D\u6E05\u5355\uFF1A
${sheetText(sheet)}`;
      const entry = sheet.find((item) => item.label === label);
      if (entry === void 0) throw new Error(`object "${label}" not found. Objects: ${sheet.map((item) => item.label).join(", ")}`);
      if (entry.x !== void 0) {
        return `${label}\uFF1A\u70B9 (${fmt(entry.x)}, ${fmt(entry.y)})${args.detail === "value" && entry.value !== void 0 ? ` \xB7 ${entry.value}` : ""}`;
      }
      const value = args.detail === "value" && entry.value !== void 0 ? ` \xB7 ${entry.value}` : "";
      return `${label}\uFF1A${entry.definition}${value}`;
    }
  }), "dsh-geogebra-chat: inspect");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_rename",
    description: "Rename a board. The board id never changes.",
    parameters: {
      type: "object",
      required: ["board", "name"],
      properties: {
        board: { type: "string", description: "Board id or name." },
        name: { type: "string", description: "New short name." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_rename requires an agent session");
      const record = resolve(session.id, args.board);
      const renamed = store.rename(session.id, record.boardId, String(args.name ?? ""));
      return `${record.boardId} \u5DF2\u6539\u540D\u4E3A\u300C${renamed?.name ?? ""}\u300D\u3002`;
    }
  }), "dsh-geogebra-chat: rename");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_list",
    description: "List every board in this session with its id, name, object count and edit state.",
    parameters: { type: "object", properties: {} },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(_args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_list requires an agent session");
      store.finalizeBefore(session.id, currentTurn(session));
      const boards = store.list(session.id);
      if (boards.length === 0) return "\u8FD9\u6B21\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u753B\u677F\u3002";
      return boards.map((record) => {
        if (record.status === "creating") return `${record.boardId}\u300C${record.name}\u300D\u5F85\u56DE\u586B`;
        const changed = diffText(record.originalSheet, record.sheet);
        const state = changed === "" ? "\u672A\u6539\u52A8" : "\u7528\u6237\u6539\u8FC7";
        return `${record.boardId}\u300C${record.name}\u300D${record.sheet?.length ?? 0} \u4E2A\u5BF9\u8C61 \xB7 ${state}${record.status === "draft" ? " \xB7 \u672C\u8F6E\u53EF\u6539" : ""}`;
      }).join("\n");
    }
  }), "dsh-geogebra-chat: list");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_export",
    description: "Export a board as .ggb (current version by default). PNG/SVG/PDF require the board to be visible and are not implemented yet.",
    parameters: {
      type: "object",
      required: ["board", "format"],
      properties: {
        board: { type: "string", description: "Board id or name." },
        format: { type: "string", enum: ["ggb", "png", "svg", "pdf"] },
        as: { type: "string", enum: ["current", "original"], description: "Which version to export (default current)." },
        path: { type: "string", description: "Optional workspace path; omitted writes under the Harness home." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_export requires an agent session");
      store.finalizeBefore(session.id, currentTurn(session));
      const record = resolve(session.id, args.board);
      if (record.status === "creating") throw new Error(`${record.boardId} \u7684 XML \u5C1A\u672A\u751F\u6210\uFF0C\u65E0\u6CD5\u5BFC\u51FA\u3002`);
      const format = String(args.format ?? "ggb");
      if (format !== "ggb") {
        throw new Error(`${format} export needs the board to be rendered; it is not implemented yet. Use .ggb for now.`);
      }
      const base64 = args.as === "original" ? record.originalGgbBase64 : record.currentGgbBase64;
      if (base64 === void 0) throw new Error(`${record.boardId} has no .ggb snapshot yet`);
      const target = typeof args.path === "string" && args.path.trim() !== "" ? args.path : join2(dshHome(), "geogebra", "exports", `${record.boardId}-${record.name}-${Date.now()}.ggb`);
      const absolute = target.startsWith("/") || /^[A-Za-z]:/.test(target) ? target : join2(process.cwd(), target);
      mkdirSync2(join2(absolute, ".."), { recursive: true });
      writeFileSync2(absolute, Buffer.from(base64, "base64"));
      return `\u5DF2\u5BFC\u51FA ${record.boardId}\u300C${record.name}\u300D\u5230 ${absolute}`;
    }
  }), "dsh-geogebra-chat: export");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_modes",
    description: "List GeoGebra app modes or show one mode in detail. Call this when you are unsure which appName fits the construction.",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", description: "Mode id such as suite, classic, graphing, geometry, 3d. Omit to list all." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args) {
      const app = typeof args.app === "string" ? args.app.trim() : "";
      if (app !== "") {
        const text = modeText(app);
        if (text === "") throw new Error(`unknown mode "${app}". Available: suite, classic, graphing, geometry, 3d, scientific, evaluator, notes.`);
        return text;
      }
      return catalogText();
    }
  }), "dsh-geogebra-chat: modes");
  ctx.effect(() => ctx.tools.register({
    name: "geogebra_delete",
    description: "Delete a board and its saved construction. Only call this when the user explicitly asks to delete it; never delete proactively.",
    parameters: {
      type: "object",
      required: ["board"],
      properties: {
        board: { type: "string", description: "Board id or name." }
      }
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }]
    },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (session === void 0) throw new Error("geogebra_delete requires an agent session");
      store.finalizeBefore(session.id, currentTurn(session));
      const record = resolve(session.id, args.board);
      store.delete(session.id, record.boardId);
      return `\u5DF2\u5220\u9664 ${record.boardId}\u300C${record.name}\u300D\u3002`;
    }
  }), "dsh-geogebra-chat: delete");
}
export {
  apply,
  inject,
  name
};
