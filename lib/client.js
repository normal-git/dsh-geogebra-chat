window.__ModuleLoader__.load({ id: "@normal-git/dsh-geogebra-chat", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React = __toESM(require("react"), 1);
var name = "dsh-geogebra-chat-client";
var inject = ["slots", "uiConversation", "connection"];
var rpc;
function perspectiveFor(appName, algebra) {
  if (appName === "3d") return algebra ? "AT" : "T";
  return algebra ? "AG" : "G";
}
function boardHtml(showInput, perspective, appName) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; }
      body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fff; }
      #ggb { position: absolute; inset: 0; }
      #status { position: absolute; inset: 0; display: grid; place-items: center; color: #5b6b80; background: #fbfcfe; }
      #status[hidden] { display: none; }
      #error { color: #b3261e; max-width: 520px; text-align: center; }
      /* GeoGebra error dialogs are read programmatically and dismissed; never
         show them over the board. */
      .dialogComponent, .gwt-PopupPanelGlass { display: none !important; }
      /* Undo/redo belong to the algebra editing surface; hide them while the
         algebra pane is hidden. */
      body.hide-undo .undoRedoPanel { display: none !important; }
    </style>
  </head>
  <body>
    <div id="ggb"></div>
    <div id="status"><div id="error">\u6B63\u5728\u52A0\u8F7D GeoGebra\u2026</div></div>
    <script src="https://www.geogebra.org/scripts/deployggb.js"><\/script>
    <script>
      (function () {
        var status = document.getElementById('status');
        var error = document.getElementById('error');
        function fail(message) {
          status.hidden = false;
          error.textContent = 'GeoGebra \u52A0\u8F7D\u5931\u8D25\uFF1A' + message;
        }
        if (typeof GGBApplet !== 'function') {
          fail('deployggb.js \u4E0D\u53EF\u7528\uFF08\u7F51\u7EDC\u6216\u955C\u50CF\u95EE\u9898\uFF09');
          return;
        }
        var params = {
          appName: '${appName}',
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          showMenuBar: false,
          showToolBar: true,
          showAlgebraInput: ${showInput ? "true" : "false"},
          showKeyboardButton: false,
          showResetIcon: false,
          showFullscreenButton: false,
          perspective: '${perspective}',
          language: 'zh',
          borderColor: '#ffffff',
          appletOnLoad: function (api) {
            window.ggbAPI = api;
            status.hidden = true;

            // Native GeoGebra undo/redo is kept. The only interception is a
            // one-shot restore hook: after "\u8FD8\u539F", one undo brings back the
            // user's own construction (setXML is not on GeoGebra's undo stack).
            window.__dshRestore = null;
            function repaintSoon() {
              window.__dshSuppressUntil = Date.now() + 1200;
              [120, 360, 800].forEach(function (ms) {
                setTimeout(function () {
                  try { if (typeof api.refreshViews === 'function') api.refreshViews(); } catch (e) { /* ignore */ }
                }, ms);
              });
            }
            document.addEventListener('click', function (event) {
              var target = event.target && event.target.closest
                ? event.target.closest('.undoRedoPanel button.undo, .undoRedoPanel button.redo')
                : null;
              if (target === null) return;
              var isUndo = target.classList.contains('undo');
              if (isUndo && typeof window.__dshRestore === 'string') {
                event.preventDefault();
                event.stopPropagation();
                var restoreXml = window.__dshRestore;
                window.__dshRestore = null;
                window.__dshSuppressUntil = Date.now() + 700;
                try { api.setXML(restoreXml); } catch (e) { fail(String(e)); }
                repaintSoon();
                return;
              }
              repaintSoon();
            }, true);
            document.addEventListener('keydown', function (event) {
              if (!(event.ctrlKey || event.metaKey)) return;
              var key = String(event.key).toLowerCase();
              if (key === 'z' && typeof window.__dshRestore === 'string') {
                var el = event.target;
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
                event.preventDefault();
                event.stopPropagation();
                var restoreXml = window.__dshRestore;
                window.__dshRestore = null;
                window.__dshSuppressUntil = Date.now() + 700;
                try { api.setXML(restoreXml); } catch (e) { fail(String(e)); }
                repaintSoon();
                return;
              }
              if (key === 'z' || key === 'y') repaintSoon();
            }, true);

            try {
              api.setAxesVisible(true, true);
              // Suite/3D keep their side panes until the perspective is applied
              // at runtime; the host side calls this again after setXML.
              if ('${perspective}' !== '') api.setPerspective('${perspective}');
              document.body.classList.toggle('hide-undo', true);
            } catch (e) { fail(String(e)); }
            // The card resizes the iframe element without a window resize event.
            if (typeof ResizeObserver === 'function') {
              new ResizeObserver(function () {
                if (!window.ggbAPI) return;
                try {
                  window.ggbAPI.setWidth(document.documentElement.clientWidth);
                  window.ggbAPI.setHeight(document.documentElement.clientHeight);
                } catch (e) { /* ignore */ }
              }).observe(document.getElementById('ggb'));
            }
          },
        };
        try {
          new GGBApplet(params, true).inject('ggb');
        } catch (e) {
          fail(String(e));
        }
        window.addEventListener('resize', function () {
          if (window.ggbAPI) {
            window.ggbAPI.setWidth(document.documentElement.clientWidth);
            window.ggbAPI.setHeight(document.documentElement.clientHeight);
          }
        });
      })();
    <\/script>
  </body>
</html>`;
}
function round2(value) {
  if (value === void 0 || !Number.isFinite(value)) return "?";
  return String(Math.round(value * 100) / 100);
}
function buildSheet(api) {
  const entries = [];
  let labels = [];
  try {
    labels = api.getAllObjectNames();
  } catch {
    return entries;
  }
  for (const label of labels) {
    try {
      const type = String(api.getObjectType(label) ?? "");
      const definition = String(api.getDefinitionString(label) ?? "");
      const value = String(api.getValueString(label) ?? "");
      if (type === "point" && api.isIndependent(label) === true) {
        const x = Number(api.getXcoord(label));
        const y = Number(api.getYcoord(label));
        entries.push({
          label,
          type,
          definition,
          text: `${label}(${round2(x)},${round2(y)})`,
          x,
          y,
          value
        });
        continue;
      }
      const text = definition === "" ? `${label}=${value}` : `${label}=${definition}`;
      entries.push({ label, type, definition, text, value });
    } catch {
    }
  }
  return entries;
}
async function readDialog(win) {
  if (win === null || win === void 0) return void 0;
  await new Promise((resolve) => setTimeout(resolve, 180));
  try {
    const nodes = [...win.document.querySelectorAll(".dialogComponent")];
    if (nodes.length === 0) return void 0;
    const raw = nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()).join(" ");
    for (const node of nodes) {
      const buttons = [...node.querySelectorAll("button")];
      const button = buttons.find((item) => /确定|关闭|OK|Close/i.test(item.textContent ?? "")) ?? buttons[buttons.length - 1];
      if (button !== void 0) button.click();
      else node.remove();
    }
    return raw.replace(/^(Error|错误)\s*/i, "").replace(/\s*(确定|关闭|在线帮助|OK|Close)\s*$/gi, "").trim();
  } catch {
    return void 0;
  }
}
function BoardCard({ node, sessionId }) {
  const boardId = typeof node.data?.boardId === "string" ? node.data.boardId : "";
  const name2 = typeof node.data?.name === "string" ? node.data.name : boardId;
  const foldKey = `dsh-geogebra-chat:fold:${String(sessionId ?? "")}:${boardId}`;
  const iframeRef = React.useRef(null);
  const apiRef = React.useRef(null);
  const startedRef = React.useRef(false);
  const debounceRef = React.useRef(void 0);
  const watchRef = React.useRef(void 0);
  const lastXmlRef = React.useRef("");
  const [payload, setPayload] = React.useState(null);
  const [error, setError] = React.useState("");
  const [showAlgebra, setShowAlgebra] = React.useState(false);
  const [status, setStatus] = React.useState("\u6B63\u5728\u51C6\u5907\u753B\u677F\u2026");
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [boardHeight, setBoardHeight] = React.useState(440);
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return window.localStorage.getItem(foldKey) === "1";
    } catch {
      return false;
    }
  });
  const [boardReady, setBoardReady] = React.useState(false);
  const [resizing, setResizing] = React.useState(false);
  const [deleted, setDeleted] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (typeof sessionId !== "string" || boardId === "" || rpc === void 0) return;
    let cancelled = false;
    const call = rpc;
    void call.call("/api", "geogebra/board/get", { sessionId, boardId }).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        const message = response.error?.message ?? "\u753B\u677F\u4E0D\u5B58\u5728";
        if (/not found/i.test(message)) setDeleted(true);
        else setError(message);
        return;
      }
      setPayload(response.value);
    }).catch((failure) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, boardId]);
  React.useEffect(() => {
    if (payload === null || rpc === void 0) return;
    startedRef.current = false;
    setLoadFailed(false);
    setBoardReady(false);
    const call = rpc;
    const current = payload;
    const loadTimer = window.setTimeout(() => {
      if (!startedRef.current) setLoadFailed(true);
    }, 25e3);
    const timer = window.setInterval(() => {
      const api = iframeRef.current?.contentWindow?.ggbAPI;
      if (api === void 0) return;
      window.clearInterval(timer);
      window.clearTimeout(loadTimer);
      startedRef.current = true;
      apiRef.current = api;
      void (async () => {
        try {
          if (current.status !== "creating") {
            if (current.currentXml !== void 0) api.setXML(current.currentXml);
          } else {
            if (current.baseXml !== void 0) api.setXML(current.baseXml);
            const failed = [];
            const warnings = [];
            for (const line of current.commands) {
              let accepted = true;
              try {
                accepted = api.evalCommand(line);
              } catch (failure) {
                accepted = false;
                failed.push({ command: line, error: failure instanceof Error ? failure.message : String(failure) });
                continue;
              }
              if (accepted === false) {
                const dialog = await readDialog(iframeRef.current?.contentWindow);
                if (dialog === void 0 || dialog === "") {
                  warnings.push({ command: line, note: "GeoGebra returned false without an error" });
                } else {
                  failed.push({ command: line, error: dialog });
                }
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
            await call.call("/api", "geogebra/board/receipt", {
              sessionId,
              boardId,
              xml: api.getXML(),
              ggbBase64: api.getBase64(),
              sheet: buildSheet(api),
              failed,
              warnings
            });
          }
          try {
            api.setPerspective(perspectiveFor(current.appName, false));
            iframeRef.current?.contentWindow?.document.body.classList.add("hide-undo");
          } catch {
          }
          setBoardReady(true);
          const repaint = () => {
            try {
              api.refreshViews?.();
            } catch {
            }
          };
          repaint();
          window.setTimeout(repaint, 250);
          window.setTimeout(repaint, 800);
          lastXmlRef.current = api.getXML();
          const scheduleUpdate = () => {
            if (debounceRef.current !== void 0) window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => {
              const win = iframeRef.current?.contentWindow;
              if (win !== void 0 && typeof win.__dshSuppressUntil === "number" && Date.now() < win.__dshSuppressUntil) {
                scheduleUpdate();
                return;
              }
              if (rpc === void 0) return;
              void rpc.call("/api", "geogebra/board/update", {
                sessionId,
                boardId,
                xml: api.getXML(),
                ggbBase64: api.getBase64(),
                sheet: buildSheet(api)
              }).catch(() => void 0);
            }, 500);
          };
          watchRef.current = window.setInterval(() => {
            const xml = api.getXML();
            if (xml === lastXmlRef.current) return;
            lastXmlRef.current = xml;
            scheduleUpdate();
          }, 1e3);
          setStatus("");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      })();
    }, 100);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(loadTimer);
      if (watchRef.current !== void 0) window.clearInterval(watchRef.current);
      if (debounceRef.current !== void 0) window.clearTimeout(debounceRef.current);
    };
  }, [payload === null ? -1 : payload.attempt, sessionId, boardId, reloadKey]);
  React.useEffect(() => {
    if (payload === null || payload.status === "final" || rpc === void 0) return;
    const call = rpc;
    const attempt = payload.attempt;
    const status2 = payload.status;
    const timer = window.setInterval(() => {
      void call.call("/api", "geogebra/board/get", { sessionId, boardId }).then((response) => {
        if (!response.ok) return;
        const next = response.value;
        if (next.attempt !== attempt || next.status !== status2) setPayload(next);
      }).catch(() => void 0);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [payload, sessionId, boardId]);
  const buttonStyle = {
    cursor: "pointer",
    background: "#fff",
    color: "inherit",
    border: "1px solid var(--dsh-border, #d9e2ef)",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "12px",
    lineHeight: "18px",
    whiteSpace: "nowrap"
  };
  const toggleAlgebra = () => {
    const next = !showAlgebra;
    setShowAlgebra(next);
    try {
      apiRef.current?.setPerspective(perspectiveFor(payload?.appName ?? "suite", next));
      const doc = iframeRef.current?.contentWindow?.document;
      doc?.body.classList.toggle("hide-undo", !next);
    } catch {
    }
  };
  const resetToOriginal = () => {
    if (payload?.originalXml === void 0) return;
    try {
      const api = apiRef.current;
      const current = api?.getXML();
      const win = iframeRef.current?.contentWindow;
      if (win !== void 0 && typeof current === "string") win.__dshRestore = current;
      api?.setXML(payload.originalXml);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const deleteBoard = () => {
    if (rpc === void 0 || typeof sessionId !== "string") return;
    setDeleting(true);
    void rpc.call("/api", "geogebra/board/delete", { sessionId, boardId }).then((response) => {
      if (!response.ok) {
        setDeleting(false);
        return;
      }
      window.setTimeout(() => {
        setDeleted(true);
        try {
          window.localStorage.removeItem(foldKey);
        } catch {
        }
      }, 240);
    }).catch(() => setDeleting(false));
  };
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(foldKey, next ? "1" : "0");
      } catch {
      }
      return next;
    });
  };
  const requestDelete = () => {
    if (confirmDelete) {
      setConfirmDelete(false);
      deleteBoard();
      return;
    }
    setConfirmDelete(true);
    window.setTimeout(() => setConfirmDelete(false), 4e3);
  };
  const startResize = (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = boardHeight;
    setResizing(true);
    const onMove = (move) => {
      setBoardHeight(Math.max(180, Math.min(900, startHeight + (move.clientY - startY))));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const linkButtonStyle = {
    background: "transparent",
    border: "none",
    color: "#4b5563",
    fontSize: "12px",
    lineHeight: "18px",
    padding: "2px 6px",
    cursor: "pointer",
    borderRadius: "4px",
    whiteSpace: "nowrap"
  };
  const divider = (key) => React.createElement("span", {
    key,
    style: { width: "1px", height: "12px", background: "#e5e7eb", margin: "0 2px" }
  });
  if (deleted) {
    return React.createElement("div", {
      style: {
        border: "1px solid var(--dsh-border, #e5e7eb)",
        borderRadius: "10px",
        margin: "8px 0",
        background: "var(--dsh-surface, #fff)",
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "5px 10px",
        background: "#f7f8fa",
        color: "#9ca3af",
        fontSize: "12px"
      }
    }, [
      React.createElement("span", { key: "title" }, `${name2} - ${boardId}`),
      React.createElement("span", { key: "state" }, "\u5DF2\u88AB\u5220\u9664")
    ]));
  }
  return React.createElement("div", {
    style: {
      border: "1px solid var(--dsh-border, #e5e7eb)",
      borderRadius: "10px",
      margin: "8px 0",
      background: "var(--dsh-surface, #fff)",
      overflow: "hidden"
    }
  }, [
    React.createElement("div", {
      key: "head",
      style: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "5px 10px",
        background: "#f7f8fa",
        borderBottom: "1px solid #e8ebf0"
      }
    }, [
      React.createElement("span", {
        key: "title",
        title: `${payload?.name ?? name2} - ${boardId}`,
        style: {
          fontSize: "12px",
          fontWeight: 400,
          color: "#374151",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0
        }
      }, `${payload?.name ?? name2} - ${boardId}`),
      status === "" ? null : React.createElement("span", {
        key: "status",
        style: { color: "#9ca3af", fontSize: "12px", whiteSpace: "nowrap" }
      }, status),
      React.createElement("div", {
        key: "actions",
        style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: "2px" }
      }, [
        React.createElement("button", {
          key: "algebra",
          type: "button",
          onClick: toggleAlgebra,
          style: linkButtonStyle
        }, showAlgebra ? "\u9690\u85CF\u4EE3\u6570\u533A" : "\u663E\u793A\u4EE3\u6570\u533A"),
        divider("d1"),
        React.createElement("button", {
          key: "reset",
          type: "button",
          onClick: resetToOriginal,
          style: linkButtonStyle
        }, "\u8FD8\u539F"),
        divider("d2"),
        React.createElement("button", {
          key: "collapse",
          type: "button",
          "aria-label": collapsed ? "\u5C55\u5F00\u753B\u677F" : "\u6298\u53E0\u753B\u677F",
          onClick: toggleCollapsed,
          style: linkButtonStyle
        }, collapsed ? "\u5C55\u5F00" : "\u6298\u53E0"),
        divider("d3"),
        React.createElement("button", {
          key: "delete",
          type: "button",
          onClick: requestDelete,
          style: { ...linkButtonStyle, color: "#b3261e", minWidth: "4.5em", textAlign: "center" }
        }, confirmDelete ? "\u786E\u8BA4\u5220\u9664" : "\u5220\u9664")
      ])
    ]),
    payload?.caption === void 0 ? null : React.createElement("div", {
      key: "caption",
      title: payload.caption,
      style: {
        padding: "6px 10px 0",
        fontSize: "12px",
        color: "#6b7280",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, payload.caption),
    React.createElement("div", {
      key: "board",
      style: {
        display: "grid",
        gridTemplateRows: collapsed || deleting ? "0fr" : "1fr",
        transition: "grid-template-rows 200ms ease"
      }
    }, React.createElement("div", {
      key: "clip",
      style: { overflow: "hidden" }
    }, React.createElement("div", {
      key: "inner",
      style: { display: "grid", gap: "2px", padding: "6px 10px 8px" }
    }, [
      React.createElement("div", {
        key: "frame",
        style: { position: "relative", height: boardHeight, minHeight: "180px" }
      }, [
        payload === null ? React.createElement("div", {
          key: "loading",
          style: { height: "100%", display: "grid", placeItems: "center", color: "#6b7c93" }
        }, "\u6B63\u5728\u51C6\u5907\u753B\u677F\u2026") : React.createElement("iframe", {
          key: `${boardId}:${payload.attempt}:${reloadKey}`,
          ref: iframeRef,
          title: `GeoGebra ${boardId}`,
          srcDoc: boardHtml(false, perspectiveFor(payload.appName, false), payload.appName),
          style: {
            width: "100%",
            height: "100%",
            border: "0",
            display: "block",
            background: "#fff",
            pointerEvents: resizing ? "none" : "auto"
          }
        }),
        payload !== null && !boardReady ? React.createElement("div", {
          key: "drawing",
          style: {
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(255, 255, 255, 0.85)",
            color: "#6b7c93",
            fontSize: "12px",
            zIndex: 1
          }
        }, "\u6B63\u5728\u7ED8\u5236\u2026") : null
      ]),
      React.createElement("div", {
        key: "resize",
        onPointerDown: startResize,
        title: "\u62D6\u52A8\u8C03\u6574\u9AD8\u5EA6",
        style: { height: "8px", cursor: "ns-resize", display: "grid", placeItems: "center" }
      }, React.createElement("div", {
        key: "grip",
        style: { width: "36px", height: "2px", borderRadius: "1px", background: "var(--dsh-border, #d9e2ef)" }
      }))
    ]))),
    loadFailed ? React.createElement("div", {
      key: "load-failed",
      style: { display: "flex", alignItems: "center", gap: "8px", color: "#b3261e", fontSize: "12px", padding: "0 10px 8px" }
    }, [
      React.createElement("span", { key: "t" }, "GeoGebra \u52A0\u8F7D\u8D85\u65F6\uFF08\u53EF\u80FD\u7F51\u7EDC\u6162\uFF09\u3002"),
      React.createElement("button", {
        key: "retry",
        type: "button",
        onClick: () => {
          setLoadFailed(false);
          setReloadKey((value) => value + 1);
        },
        style: linkButtonStyle
      }, "\u91CD\u8BD5")
    ]) : null,
    error === "" ? null : React.createElement("div", {
      key: "error",
      style: { color: "#b3261e", fontSize: "12px", padding: "0 10px 8px" }
    }, error)
  ]);
}
var boardNodeDefinition = {
  kind: "geogebra-board",
  target: "chat",
  match: (event) => {
    if (event.type !== "plugin:dsh-geogebra-chat/board") return null;
    const boardId = event.data?.boardId;
    return { id: typeof boardId === "string" ? boardId : String(event.seq), role: "start" };
  },
  start: (_context, match) => ({ ...match.event.data }),
  update: (context) => context.state,
  buildViewNode: (context) => {
    const state = context.state;
    if (state === void 0) return null;
    const seq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0;
    return {
      key: context.key,
      kind: "geogebra-board",
      id: context.id,
      target: "chat",
      anchorSeq: seq,
      location: context.start?.location ?? { kind: "unresolved" },
      visibility: "visible",
      groupTree: "turn",
      data: state
    };
  }
};
function apply(ctx) {
  rpc = ctx.connection?.rpc;
  ctx.uiConversation.events.register(boardNodeDefinition);
  ctx.slots.inject("conversation.chat.node", () => ctx.slots.register(
    { name: "conversation.chat.node", key: "geogebra-board" },
    BoardCard
  ));
}

return module.exports; } });
//# sourceMappingURL=client.js.map
