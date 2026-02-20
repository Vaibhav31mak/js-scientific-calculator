(function () {
  /* ===== Storage Keys ===== */
  var HISTORY_KEY = "scientific_calc_history";
  var THEME_KEY = "scientific_calc_theme";

  /* ===== Utility Module (Closure – private helpers) ===== */
  var Utils = (function () {
    function formatNumber(v) {
      if (Number.isNaN(v) || !Number.isFinite(v)) return "Error";
      var a = Math.abs(v);
      if (a !== 0 && (a < 1e-30 || a > 1e30))
        return v.toExponential(8).replace(/\.?0+e/, "e");
      var str = v.toString();
      if (str.length > 50) return parseFloat(v.toPrecision(14)).toString();
      return str;
    }

    function formatIndianInteger(intPart) {
      if (!intPart) return "";
      if (intPart.length <= 3) return intPart;
      var last3 = intPart.slice(-3);
      var rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
      return rest + "," + last3;
    }

    function formatIndianNumberString(n) {
      var sign = "";
      var raw = String(n || "");
      if (!raw) return raw;
      if (raw.charAt(0) === "-") {
        sign = "-";
        raw = raw.slice(1);
      }
      var parts = raw.split(".");
      var intPart = parts[0] || "0";
      var fracPart = parts.length > 1 ? "." + parts.slice(1).join(".") : "";
      return sign + formatIndianInteger(intPart) + fracPart;
    }

    function formatExpressionForDisplay(expr) {
      return String(expr || "").replace(/-?\d+(?:\.\d+)?/g, function (m) {
        return formatIndianNumberString(m);
      });
    }

    function splitExpressionDisplay(expr, fallbackMain) {
      var raw = String(expr || "");
      var fallback = String(fallbackMain || "0");
      if (!raw) return { upper: "", main: fallback };

      var m = raw.match(/(-?\d*\.?\d+(?:[eE][+\-]?\d+)?)$/);
      if (m && (m.index + m[0].length === raw.length)) {
        return { upper: raw.slice(0, m.index), main: m[0] };
      }

      if (/[+\-*/%^(]$/.test(raw)) {
        return { upper: raw, main: "0" };
      }

      return { upper: "", main: raw };
    }

    function factorial(n) {
      if (!Number.isInteger(n) || n < 0)
        throw new Error("Invalid input");
      if (n > 170) throw new Error("Value too large");
      var r = 1;
      for (var i = 2; i <= n; i++) r *= i;
      return r;
    }

    function toRad(deg) { return deg * Math.PI / 180; }
    function toDeg(rad) { return rad * 180 / Math.PI; }

    return {
      formatNumber: formatNumber,
      formatExpressionForDisplay: formatExpressionForDisplay,
      splitExpressionDisplay: splitExpressionDisplay,
      factorial: factorial,
      toRad: toRad,
      toDeg: toDeg
    };
  })();

  /* ===== BasicOperations via Prototype ===== */
  function BasicOperations() {}
  BasicOperations.prototype.add      = function (a, b) { return a + b; };
  BasicOperations.prototype.subtract = function (a, b) { return a - b; };
  BasicOperations.prototype.multiply = function (a, b) { return a * b; };
  BasicOperations.prototype.divide   = function (a, b) {
    if (b === 0) throw new Error("Cannot divide by zero");
    return a / b;
  };
  BasicOperations.prototype.mod = function (a, b) {
    if (b === 0) throw new Error("Cannot mod by zero");
    return a % b;
  };

  /* ===== History Store (Closure – encapsulated private state + localStorage) ===== */
  function createHistoryStore(limit) {
    var max = typeof limit === "number" ? limit : 30;
    var entries = [];

    (function load() {
      try {
        var raw = localStorage.getItem(HISTORY_KEY);
        if (raw) { var p = JSON.parse(raw); if (Array.isArray(p)) entries = p.slice(0, max); }
      } catch (_) { entries = []; }
    })();

    function save() { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); }

    return {
      add: function (expr, result) {
        entries.unshift({ expression: expr, result: result, at: Date.now() });
        if (entries.length > max) entries.length = max;
        save();
      },
      list: function () { return entries.slice(); },
      clear: function () { entries = []; save(); }
    };
  }

  /* ===== Calculator Class (extends BasicOperations) ===== */
  class Calculator extends BasicOperations {
    constructor(store) {
      super();
      this.expression = "";
      this.result = "0";
      this.memory = 0;
      this.store = store;
      this.isDeg = true;        // DEG mode
      this.isFE = false;        // F-E (scientific notation) toggle
      this.isSecond = false;    // 2nd toggle
      this.hasMemory = false;   // whether memory is stored
      this.symbolicExpression = ""; // for history display with symbols
    }

    /* ---- Input helpers ---- */
    append(v) {
      v = String(v);
      if (v === "(") {
        var last = this.expression.slice(-1);
        if (/[0-9.)]/.test(last)) {
          this.expression += "*(";
          return;
        }
      }
      if (/^\d$/.test(v)) {
        var m = this.expression.match(/(^|[+\-*/%(])(-?)0$/);
        if (m) {
          if (v === "0") return;
          this.expression = this.expression.slice(0, -1) + v;
          return;
        }
      }
      this.expression += v;
    }
    appendOp(op) {
      var last = this.expression.slice(-1);
      if ("+-*/%^".indexOf(last) !== -1) this.expression = this.expression.slice(0, -1);
      this.expression += op;
    }
    clear()     { this.expression = ""; this.result = "0"; }
    backspace() { this.expression = this.expression.slice(0, -1); }

    toggleSign() {
      if (!this.expression) { this.expression = "-"; return; }
      var m = this.expression.match(/(-?\d*\.?\d+)(?!.*\d)/);
      if (!m) return;
      var cur = m[1];
      var tog = cur.charAt(0) === "-" ? cur.slice(1) : "-" + cur;
      this.expression = this.expression.slice(0, m.index) + tog;
    }

    /* ---- Evaluate ---- */
    _prepareExpression() {
      var e = this.expression.trim();
      if (!e) return "";

      function fixParentheses(expr) {
        var out = "";
        var open = 0;
        var ops = "+-*/%^";

        for (var i = 0; i < expr.length; i++) {
          var ch = expr.charAt(i);

          if (ch === "(") {
            out += ch;
            open++;
            continue;
          }

          if (ch === ")") {
            if (open === 0) continue;
            var prev = out.slice(-1);
            if (prev === "(" || ops.indexOf(prev) !== -1) out += "0";
            out += ")";
            open--;
            continue;
          }

          out += ch;
        }

        while (open > 0) {
          var tail = out.slice(-1);
          if (tail === "(" || ops.indexOf(tail) !== -1) out += "0";
          out += ")";
          open--;
        }

        return out;
      }

      e = fixParentheses(e);
      e = e.replace(/(^|[+\-*/%^(])(-?)0+(\d+(?:\.\d+)?)/g, "$1$2$3");
      return e;
    }

    _eval(preparedExpression) {
      var e = typeof preparedExpression === "string" ? preparedExpression : this._prepareExpression();
      if (!e) return 0;
      var evalExpr = e.replace(/\^/g, "**");
      // Allow only safe chars
      if (!/^[0-9+\-*/%.()\s]*$/.test(evalExpr)) throw new Error("Invalid expression");
      var r;
      try {
        r = Function('"use strict"; return (' + evalExpr + ')')();
      } catch (_) {
        throw new Error("Invalid expression");
      }
      if (Number.isNaN(r)) throw new Error("Invalid input");
      if (!Number.isFinite(r)) throw new Error("Overload");
      return r;
    }

    evaluate() {
      var before = this._prepareExpression() || "0";
      var historyExpr = this.symbolicExpression || before;
      var val = this._eval(before);
      var fmt = this.isFE ? val.toExponential(4) : Utils.formatNumber(val);
      this.result = fmt;
      this.expression = fmt;
      this.symbolicExpression = "";
      this.store.add(historyExpr, fmt);
      return fmt;
    }

    /* ---- Angle helper ---- */
    _angleIn(v) { return this.isDeg ? Utils.toRad(v) : v; }
    _angleOut(v) { return this.isDeg ? Utils.toDeg(v) : v; }

    /* ---- Unary operations ---- */
    applyUnary(action, skipSymbolic) {
      var v = this._eval();
      var n;
      var symbol = "";
      switch (action) {
        case "sqrt":
          if (v < 0) throw new Error("Invalid input"); n = Math.sqrt(v); symbol = "√"; break;
        case "cbrt":       n = Math.cbrt(v); break;
        case "square":     n = v * v; break;
        case "cube":       n = v * v * v; break;
        case "inverse":    n = this.divide(1, v); break;
        case "abs":        n = Math.abs(v); break;
        case "log":        if (v <= 0) throw new Error("Invalid input"); n = Math.log10(v); break;
        case "ln":         if (v <= 0) throw new Error("Invalid input"); n = Math.log(v); break;
        case "log2":       if (v <= 0) throw new Error("Invalid input"); n = Math.log2(v); break;
        case "sin":        n = Math.sin(this._angleIn(v)); break;
        case "cos":        n = Math.cos(this._angleIn(v)); break;
        case "tan":        n = Math.tan(this._angleIn(v)); break;
        case "sec":        n = 1 / Math.cos(this._angleIn(v)); break;
        case "csc":        n = 1 / Math.sin(this._angleIn(v)); break;
        case "cot":        n = 1 / Math.tan(this._angleIn(v)); break;
        case "asin":       if (v < -1 || v > 1) throw new Error("Invalid input"); n = this._angleOut(Math.asin(v)); break;
        case "acos":       if (v < -1 || v > 1) throw new Error("Invalid input"); n = this._angleOut(Math.acos(v)); break;
        case "atan":       n = this._angleOut(Math.atan(v)); break;
        case "asec":       n = this._angleOut(Math.acos(1 / v)); break;
        case "acsc":       n = this._angleOut(Math.asin(1 / v)); break;
        case "acot":       n = this._angleOut(Math.atan(1 / v)); break;
        case "factorial":  n = Utils.factorial(v); break;
        case "exp":        n = Math.exp(v); break;
        case "floor":      n = Math.floor(v); break;
        case "ceil":       n = Math.ceil(v); break;
        case "negate":     n = -v; break;
        case "pow10":      n = Math.pow(10, v); break;
        case "2x":         n = Math.pow(2, v); symbol = "2^"; break;
        default: throw new Error("Unknown operation");
      }
      var fmt = this.isFE ? n.toExponential(4) : Utils.formatNumber(n);
      if (!skipSymbolic && symbol) {
        var currentExpr = this.expression;
        this.symbolicExpression = symbol + "(" + currentExpr + ")";
        this.expression = fmt;
        this.result = fmt;
      } else {
        this.symbolicExpression = "";
        this.expression = fmt;
        this.result = fmt;
      }
      return fmt;
    }

    applyPow10ToCurrent() {
      var expr = this.expression || "";
      var match = expr.match(/(-?\d*\.?\d+)(?!.*\d)/);
      var hasTailNumber = !!(match && (match.index + match[0].length === expr.length));
      var prefix = "";
      var currentValue;

      if (hasTailNumber) {
        prefix = expr.slice(0, match.index);
        currentValue = parseFloat(match[0]);
      } else if (/[+\-*/%^(]$/.test(expr)) {
        prefix = expr;
        currentValue = 0;
      } else if (expr.trim()) {
        currentValue = this._eval();
      } else {
        var fromResult = parseFloat(this.result);
        currentValue = Number.isFinite(fromResult) ? fromResult : 0;
      }

      var n = Math.pow(10, currentValue);
      var fmt = this.isFE ? n.toExponential(4) : Utils.formatNumber(n);
      this.expression = prefix + fmt;
      this.result = fmt;
      return fmt;
    }

    /* ---- Memory ---- */
    _memoryInputValue() {
      var fromResult = parseFloat(this.result);
      if (Number.isFinite(fromResult)) return fromResult;
      return this._eval();
    }
    memoryStore()    { this.memory = this._memoryInputValue(); this.hasMemory = true; }
    memoryRecall()   {
      if (!this.hasMemory) return;
      var mem = Utils.formatNumber(this.memory);
      this.expression = mem;
      this.result = mem;
    }
    memoryClear()    { this.memory = 0; this.hasMemory = false; }
    memoryAdd()      { this.memory = this.add(this.memory, this._memoryInputValue()); this.hasMemory = true; }
    memorySubtract() { this.memory = this.subtract(this.memory, this._memoryInputValue()); this.hasMemory = true; }
  }

  /* ===== App Controller (uses `this` in event handlers via bind) ===== */
  class CalculatorApp {
    constructor() {
      this.displayEl       = document.getElementById("display");
      this.expressionEl    = document.getElementById("expression");
      this.historyEl       = document.getElementById("historyList");
      this.clearHistoryBtn = document.getElementById("clearHistoryBtn");
      this.historyTabsEl   = document.querySelector(".history-tabs");
      this.historyTabBtn   = document.querySelector('.tab-btn[data-tab="history"]');
      this.memoryTabBtn    = document.querySelector('.tab-btn[data-tab="memory"]');
      this.themeToggleBtn  = document.getElementById("themeToggle");
      this.degBtn          = document.querySelector('[data-mini="deg"]');
      this.feBtn           = document.querySelector('[data-mini="f-e"]');
      this.trigToggle      = document.getElementById("trigToggle");
      this.funcToggle      = document.getElementById("funcToggle");
      this.trigPanel       = document.getElementById("trigPanel");
      this.funcPanel       = document.getElementById("funcPanel");

      this.history    = createHistoryStore(30);
      this.calculator = new Calculator(this.history);
      this.activeSideTab = "history";

      // Bind handlers so `this` stays correct
      this._onKey       = this._onKey.bind(this);
      this._onBtn       = this._onBtn.bind(this);
      this._onMemBtn    = this._onMemBtn.bind(this);
      this._onPanelBtn  = this._onPanelBtn.bind(this);
      this._onTabClick  = this._onTabClick.bind(this);
      this._onHistClear = this._onHistClear.bind(this);
      this._onTheme     = this._onTheme.bind(this);
      this._onDeg       = this._onDeg.bind(this);
      this._onFE        = this._onFE.bind(this);
    }

    init() {
      document.querySelector(".keys").addEventListener("click", this._onBtn);
      document.querySelector(".memory-row").addEventListener("click", this._onMemBtn);

      // Panel toggles
      this.trigToggle.addEventListener("click", function () {
        var open = this.trigPanel.classList.toggle("open");
        this.funcPanel.classList.remove("open");
        this.trigToggle.classList.toggle("panel-open", open);
        this.funcToggle.classList.remove("panel-open");
      }.bind(this));

      this.funcToggle.addEventListener("click", function () {
        var open = this.funcPanel.classList.toggle("open");
        this.trigPanel.classList.remove("open");
        this.funcToggle.classList.toggle("panel-open", open);
        this.trigToggle.classList.remove("panel-open");
      }.bind(this));

      // Panel button clicks
      this.trigPanel.addEventListener("click", this._onPanelBtn);
      this.funcPanel.addEventListener("click", this._onPanelBtn);
      if (this.historyTabsEl) this.historyTabsEl.addEventListener("click", this._onTabClick);

      this.clearHistoryBtn.addEventListener("click", this._onHistClear);
      this.themeToggleBtn.addEventListener("click", this._onTheme);
      this.degBtn.addEventListener("click", this._onDeg);
      this.feBtn.addEventListener("click", this._onFE);
      window.addEventListener("keydown", this._onKey);

      this._restoreTheme();
      this._renderSidePanel();
      this._refresh();
      this._updateMemBtns();
    }

    _onTabClick(e) {
      var btn = e.target.closest(".tab-btn");
      if (!btn || !btn.dataset.tab) return;
      this.activeSideTab = btn.dataset.tab;
      if (this.historyTabBtn) this.historyTabBtn.classList.toggle("active", this.activeSideTab === "history");
      if (this.memoryTabBtn) this.memoryTabBtn.classList.toggle("active", this.activeSideTab === "memory");
      this._renderSidePanel();
    }

    _renderSidePanel() {
      if (this.activeSideTab === "memory") {
        this._renderMemory();
      } else {
        this._renderHistory();
      }
    }

    /* ---- Panel button clicks ---- */
    _onPanelBtn(e) {
      var btn = e.target.closest("button");
      if (!btn || !btn.dataset.action) return;
      var action = btn.dataset.action;

      try {
        if (action === "second") {
          this._toggle2nd();
        } else if (action === "hyp") {
          // hyp is a modifier – toggle hyperbolic label (placeholder)
        } else if (action === "rand") {
          this.calculator.expression = Math.random().toString();
          this.calculator.result = this.calculator.expression;
        } else if (action === "dms") {
          var val = this.calculator._eval();
          var d = Math.trunc(val);
          var m = Math.trunc((val - d) * 60);
          var s = ((val - d) * 60 - m) * 60;
          var res = d + "." + Math.abs(m) + Math.abs(s).toFixed(2).replace(".", "");
          this.calculator.expression = res;
          this.calculator.result = res;
        } else if (action === "deg2") {
          var val2 = this.calculator._eval();
          var d2 = Math.trunc(val2);
          var frac = val2 - d2;
          var min2 = Math.trunc(frac * 100);
          var sec2 = (frac * 100 - min2) * 100;
          var dec = d2 + min2 / 60 + sec2 / 3600;
          this.calculator.expression = Utils.formatNumber(dec);
          this.calculator.result = this.calculator.expression;
        } else {
          this.calculator.applyUnary(action);
        }
        this._refresh();
      } catch (err) {
        this._showError(err);
      }
    }

    /* ---- Close panels helper ---- */
    _closePanels() {
      this.trigPanel.classList.remove("open");
      this.funcPanel.classList.remove("open");
      this.trigToggle.classList.remove("panel-open");
      this.funcToggle.classList.remove("panel-open");
    }

    /* ---- DEG / F-E ---- */
    _onDeg() {
      this.calculator.isDeg = !this.calculator.isDeg;
      this.degBtn.textContent = this.calculator.isDeg ? "DEG" : "RAD";
      this.degBtn.classList.toggle("active", true);
    }

    _onFE() {
      this.calculator.isFE = !this.calculator.isFE;
      this.feBtn.classList.toggle("active", this.calculator.isFE);
      // Re-format current result
      if (this.calculator.result && this.calculator.result !== "0") {
        var num = parseFloat(this.calculator.result);
        if (!isNaN(num)) {
          this.calculator.result = this.calculator.isFE
            ? num.toExponential(4)
            : Utils.formatNumber(num);
          this.calculator.expression = this.calculator.result;
        }
      }
      this._refresh();
    }

    /* ---- Memory row ---- */
    _onMemBtn(e) {
      var btn = e.target.closest("button");
      if (!btn || !btn.dataset.action) return;
      var a = btn.dataset.action;
      try {
        switch (a) {
          case "mc":     this.calculator.memoryClear();    break;
          case "mr":     this.calculator.memoryRecall();   break;
          case "ms":     this.calculator.memoryStore();    break;
          case "mplus":  this.calculator.memoryAdd();      break;
          case "mminus": this.calculator.memorySubtract(); break;
        }
        this._updateMemBtns();
        this._renderSidePanel();
        this._refresh();
      } catch (err) { this._showError(err); }
    }

    _updateMemBtns() {
      var has = this.calculator.hasMemory;
      var mc = document.querySelector('[data-action="mc"]');
      var mr = document.querySelector('[data-action="mr"]');
      if (mc) mc.classList.toggle("disabled", !has);
      if (mr) mr.classList.toggle("disabled", !has);
    }

    /* ---- Keys grid ---- */
    _onBtn(e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      var val = btn.dataset.value;
      var op  = btn.dataset.operator;
      var act = btn.dataset.action;

      try {
        if (typeof val !== "undefined") {
          if (val === "PI")      this.calculator.append(Math.PI.toString());
          else if (val === "E")  this.calculator.append(Math.E.toString());
          else                   this.calculator.append(val);
        } else if (op) {
          this.calculator.appendOp(op);
        } else if (act) {
          this._dispatch(act);
        }
        this._refresh();
      } catch (err) {
        this._showError(err);
      }
    }

    _dispatch(action) {
      switch (action) {
        case "clear":     this.calculator.clear(); break;
        case "backspace": this.calculator.backspace(); break;
        case "equals":    this.calculator.evaluate(); this._renderSidePanel(); break;
        case "sign":      this.calculator.toggleSign(); break;
        case "open":      this.calculator.append("("); break;
        case "close":     this.calculator.append(")"); break;
        case "power":     this.calculator.appendOp("^"); break;
        case "pow10":     this.calculator.applyPow10ToCurrent(); break;
        case "second":    this._toggle2nd(); break;
        // Unary
        case "sqrt": case "cbrt":
        case "square": case "cube":
        case "inverse": case "abs":
        case "factorial": case "exp":
        case "log": case "ln": case "log2":
        case "sin": case "cos": case "tan":
        case "asin": case "acos": case "atan":
        case "2x":
          this.calculator.applyUnary(action);
          break;
      }
    }

    /* ---- 2nd function toggle ---- */
    _toggle2nd() {
      this.calculator.isSecond = !this.calculator.isSecond;
      var s = this.calculator.isSecond;
      var map = [
        { normal: "second",  sAct: "second",  sLabel: "2<sup>nd</sup>", nLabel: "2<sup>nd</sup>" },
        { normal: "square",  sAct: "cube",    sLabel: "x³",           nLabel: "x²" },
        { normal: "sqrt",    sAct: "cbrt",    sLabel: "³√x",          nLabel: "²√x" },
        { normal: "pow10",   sAct: "2x",      sLabel: "2ˣ",           nLabel: "10ˣ" },
        { normal: "log",     sAct: "log2",    sLabel: "log₂",         nLabel: "log" },
        { normal: "ln",      sAct: "exp",     sLabel: "eˣ",           nLabel: "ln" },
      ];
      // Also toggle trig dropdown items
      var trigMap = [
        { normal: "sin", sAct: "asin", sLabel: "sin⁻¹", nLabel: "sin" },
        { normal: "cos", sAct: "acos", sLabel: "cos⁻¹", nLabel: "cos" },
        { normal: "tan", sAct: "atan", sLabel: "tan⁻¹", nLabel: "tan" },
        { normal: "sec", sAct: "asec", sLabel: "sec⁻¹", nLabel: "sec" },
        { normal: "csc", sAct: "acsc", sLabel: "csc⁻¹", nLabel: "csc" },
        { normal: "cot", sAct: "acot", sLabel: "cot⁻¹", nLabel: "cot" },
      ];

      map.forEach(function (m) {
        var el = document.querySelector('.key[data-action="' + (s ? m.normal : m.sAct) + '"]');
        if (el) {
          el.dataset.action = s ? m.sAct : m.normal;
          el.innerHTML = s ? m.sLabel : m.nLabel;
        }
      });

      trigMap.forEach(function (m) {
        var el = document.querySelector('.panel-key[data-action="' + (s ? m.normal : m.sAct) + '"]');
        if (el) {
          el.dataset.action = s ? m.sAct : m.normal;
          el.textContent = s ? m.sLabel : m.nLabel;
        }
      });

      // Highlight 2nd button(s)
      var secondBtn = document.querySelector('.key[data-action="second"]');
      if (secondBtn) secondBtn.classList.toggle("active-2nd", s);
      var secondPanelBtn = document.querySelector('.panel-key[data-action="second"]');
      if (secondPanelBtn) secondPanelBtn.classList.toggle("active-2nd", s);
    }

    /* ---- Display ---- */
    _refresh() {
      var expr = this.calculator.expression || "";
      var result = this.calculator.result || "0";

      if (this.calculator.symbolicExpression && expr === result) {
        this.expressionEl.textContent = Utils.formatExpressionForDisplay(this.calculator.symbolicExpression);
        this.displayEl.textContent = Utils.formatExpressionForDisplay(result);
        return;
      }
      
      var parts = Utils.splitExpressionDisplay(expr, result);
      this.expressionEl.textContent = Utils.formatExpressionForDisplay(parts.upper);
      this.displayEl.textContent = Utils.formatExpressionForDisplay(parts.main);
    }

    _showError(err) {
      this.displayEl.textContent = (err && err.message) ? err.message : "Error";
    }

    /* ---- History ---- */
    _renderHistory() {
      var items = this.history.list();
      if (!items.length) {
        this.historyEl.innerHTML = '<li class="history-item"><p class="history-exp">There\'s no history yet.</p></li>';
        this.clearHistoryBtn.textContent = "Clear";
        this.clearHistoryBtn.style.display = "none";
        return;
      }
      this.clearHistoryBtn.textContent = "Clear";
      this.clearHistoryBtn.style.display = "";
      this.historyEl.innerHTML = items.map(function (it) {
        return '<li class="history-item"><p class="history-exp">' + it.expression +
               '</p><p class="history-res">= ' + it.result + '</p></li>';
      }).join("");
    }

    _renderMemory() {
      if (!this.calculator.hasMemory) {
        this.historyEl.innerHTML = '<li class="history-item"><p class="history-exp">There\'s nothing saved in Memory.</p></li>';
        this.clearHistoryBtn.style.display = "none";
        return;
      }
      this.clearHistoryBtn.textContent = "Clear";
      this.clearHistoryBtn.style.display = "";
      this.historyEl.innerHTML = '<li class="history-item"><p class="history-exp">M</p><p class="history-res">' + Utils.formatNumber(this.calculator.memory) + '</p></li>';
    }

    _onHistClear() {
      if (this.activeSideTab === "memory") {
        this.calculator.memoryClear();
        this._updateMemBtns();
      } else {
        this.history.clear();
      }
      this._renderSidePanel();
    }

    /* ---- Keyboard ---- */
    _onKey(e) {
      var k = e.key;
      try {
        if (/^[0-9.]$/.test(k))              { this.calculator.append(k); }
        else if ("+-*/%^".indexOf(k) !== -1)  { this.calculator.appendOp(k); }
        else if (k === "p" || k === "P" || k === "π") { this.calculator.append(Math.PI.toString()); }
        else if (k === "Enter" || k === "=")  { e.preventDefault(); this.calculator.evaluate(); this._renderSidePanel(); }
        else if (k === "Backspace")           { this.calculator.backspace(); }
        else if (k === "Escape" || k === "Delete") { this.calculator.clear(); }
        else if (k === "(")                   { this.calculator.append("("); }
        else if (k === ")")                   { this.calculator.append(")"); }
        else return; // unknown key, skip refresh
        this._refresh();
      } catch (err) { this._showError(err); }
    }

    /* ---- Theme ---- */
    _restoreTheme() {
      var saved = localStorage.getItem(THEME_KEY) || "light";
      document.body.classList.toggle("dark", saved === "dark");
    }

    _onTheme() {
      var dark = document.body.classList.toggle("dark");
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    }
  }

  /* ===== Bootstrap ===== */
  var app = new CalculatorApp();
  app.init();
})();
