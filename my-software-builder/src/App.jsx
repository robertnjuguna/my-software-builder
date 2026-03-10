import { useState, useRef, useCallback } from "react";

const EXAMPLES = [
  "Food delivery app for Nairobi with M-Pesa payments",
  "Hospital appointment booking system",
  "Real estate listings platform for Kenya",
  "Ride-hailing app for Kampala",
];

// Each phase is broken into small focused sub-tasks that each complete within ~1500 tokens
const PHASE_TASKS = {
  database: [
    { label: "Users & Auth tables",     prompt: (app) => `Generate PostgreSQL CREATE TABLE statements only for users, sessions, and auth-related tables for: ${app}. Include indexes and FK constraints. Raw SQL only, no markdown.` },
    { label: "Core domain tables",      prompt: (app) => `Generate PostgreSQL CREATE TABLE statements for the main domain entities (not users) for: ${app}. Include all columns, FK references, indexes. Raw SQL only, no markdown.` },
    { label: "Junction & lookup tables",prompt: (app) => `Generate PostgreSQL CREATE TABLE statements for any junction/pivot tables, status enums, and lookup/config tables for: ${app}. Then add INSERT seed data for all tables. Raw SQL only, no markdown.` },
  ],
  backend: [
    { label: "package.json + server.js", prompt: (app) => `Generate ONLY these 2 files for a Node.js/Express API for: ${app}\n// ===== FILE: package.json =====\n// ===== FILE: server.js =====\nReal code, JWT + bcrypt deps, proper middleware setup. No markdown.` },
    { label: "DB + Auth middleware",     prompt: (app) => `Generate ONLY these 2 files for a Node.js/Express API for: ${app}\n// ===== FILE: db.js =====  (pg Pool setup)\n// ===== FILE: middleware/auth.js ===== (JWT verify middleware)\nReal working code. No markdown.` },
    { label: "Auth routes + controller", prompt: (app) => `Generate ONLY these 2 files for a Node.js/Express API for: ${app}\n// ===== FILE: routes/auth.js =====\n// ===== FILE: controllers/authController.js ===== (register, login, logout with bcrypt+JWT)\nReal working code. No markdown.` },
    { label: "Main routes + controller", prompt: (app) => `Generate ONLY these 2 files for a Node.js/Express API for: ${app}\n// ===== FILE: routes/main.js ===== (all main CRUD routes)\n// ===== FILE: controllers/mainController.js ===== (all CRUD handlers with pg queries)\nReal working code. No markdown.` },
  ],
  frontend: [
    { label: "package.json + index.js", prompt: (app) => `Generate ONLY these 2 files for a React SPA for: ${app}\n// ===== FILE: package.json =====\n// ===== FILE: src/index.js =====\nUse react-router-dom, real deps. No markdown.` },
    { label: "App.jsx + API service",   prompt: (app) => `Generate ONLY these 2 files for a React SPA for: ${app}\n// ===== FILE: src/App.jsx ===== (router with all routes)\n// ===== FILE: src/services/api.js ===== (fetch wrapper for all endpoints)\nReal code, no markdown.` },
    { label: "Login + Register pages",  prompt: (app) => `Generate ONLY these 2 files for a React SPA for: ${app}\n// ===== FILE: src/pages/Login.jsx ===== (form, validation, JWT storage)\n// ===== FILE: src/pages/Register.jsx ===== (form, validation, API call)\nReal code with useState, no markdown.` },
    { label: "Dashboard + main pages",  prompt: (app) => `Generate the main feature pages for a React SPA for: ${app}. Generate 2-3 core pages like Dashboard, listings, orders etc. Mark each with // ===== FILE: src/pages/FileName.jsx =====. Real code with useState/useEffect/fetch. No markdown.` },
    { label: "Navbar + shared components", prompt: (app) => `Generate ONLY these files for a React SPA for: ${app}\n// ===== FILE: src/components/Navbar.jsx =====\n// ===== FILE: src/components/ProtectedRoute.jsx =====\nReal code, no markdown.` },
  ],
  deployment: [
    { label: ".env.example + Dockerfile", prompt: (app) => `Generate ONLY these 2 files for deploying: ${app}\n# ===== FILE: .env.example =====\n# ===== FILE: Dockerfile =====  (Node backend)\nReal config, no markdown.` },
    { label: "docker-compose.yml",        prompt: (app) => `Generate ONLY this file for deploying: ${app}\n# ===== FILE: docker-compose.yml ===== (services: backend, postgres, redis, nginx)\nReal config with volumes, healthchecks, env vars. No markdown.` },
    { label: "nginx.conf + CI/CD",        prompt: (app) => `Generate ONLY these 2 files for deploying: ${app}\n# ===== FILE: nginx.conf ===== (reverse proxy to Node backend, serve React build)\n# ===== FILE: .github/workflows/deploy.yml ===== (GitHub Actions: test, build, deploy)\nReal config, no markdown.` },
  ],
  preview: [
    { label: "Interactive HTML prototype", prompt: (app) => `Build a single self-contained HTML prototype for: ${app}
Rules:
- Inline CSS only, no CDN links
- Vanilla JS only  
- Dark professional theme (#0f172a background, white text, colored accents)
- 3+ navigable views/pages using JS show/hide
- Realistic hardcoded sample data in tables or cards
- Working form with JS validation and success feedback
- Smooth CSS transitions between views
Output: raw HTML starting with <!DOCTYPE html>. Nothing else.` },
  ],
};

const PHASES = [
  { id: "database",   label: "Database",    icon: "🗄️", color: "#00D4AA" },
  { id: "backend",    label: "Backend API",  icon: "⚙️",  color: "#FF6B35" },
  { id: "frontend",   label: "Frontend UI",  icon: "🎨",  color: "#A855F7" },
  { id: "deployment", label: "Deployment",   icon: "🚀",  color: "#3B82F6" },
  { id: "preview",    label: "Live Preview", icon: "🖥️",  color: "#E879F9" },
];

async function callAPI(systemMsg, userMsg, signal, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      stream: true,
      system: systemMsg,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || "HTTP " + res.status);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); throw new DOMException("Aborted", "AbortError"); }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        try {
          const j = JSON.parse(raw);
          const t = j?.delta?.text || "";
          if (t) onChunk(t);
        } catch (_) {}
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

function syntaxHL(code) {
  return code
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(\/\/[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
    .replace(/(--[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
    .replace(/(#[^\n]*)/g, '<span style="color:#6a9955">$1</span>')
    .replace(/\b(const|let|var|function|async|await|return|import|export|from|default|class|new|if|else|for|while|try|catch|throw|require)\b/g,
      '<span style="color:#ff7b72">$1</span>')
    .replace(/\b(CREATE|TABLE|PRIMARY|FOREIGN|KEY|INDEX|INSERT|SELECT|FROM|WHERE|REFERENCES|NOT|NULL|DEFAULT|UNIQUE|SERIAL|VARCHAR|INTEGER|BOOLEAN|TIMESTAMP|TEXT|JSONB|INTO|VALUES)\b/g,
      '<span style="color:#79c0ff">$1</span>');
}

function CodePanel({ content, color, phase, subLabel }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "#0d0d1a", borderBottom: "1px solid " + color + "33", flexShrink: 0 }}>
        <span style={{ color, fontSize: "11px", fontFamily: "monospace" }}>
          {phase.icon} {phase.label}
          {subLabel && <span style={{ color: "#444", marginLeft: 8 }}>→ {subLabel}</span>}
          {!content && <span style={{ color: "#333", marginLeft: 8 }}>waiting...</span>}
        </span>
        {content && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ color: "#2a2a4a", fontSize: "10px", fontFamily: "monospace" }}>{content.length.toLocaleString()} chars</span>
            <button onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ background: "transparent", border: "1px solid " + color + "44", color: copied ? color : "#555", borderRadius: "4px", padding: "2px 10px", fontSize: "11px", cursor: "pointer" }}>
              {copied ? "✓ copied" : "copy"}
            </button>
          </div>
        )}
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: "auto", padding: "14px 16px", fontFamily: "'Fira Code','Courier New',monospace", fontSize: "12px", lineHeight: "1.8", color: "#c9d1d9", background: "#070710", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {content
          ? <span dangerouslySetInnerHTML={{ __html: syntaxHL(content) }} />
          : <span style={{ color: "#1e1e35" }}>Waiting to generate...</span>}
      </div>
    </div>
  );
}

function PreviewPanel({ html }) {
  const iframeRef = useRef(null);
  const prevHtml = useRef("");
  if (html && html !== prevHtml.current) {
    prevHtml.current = html;
    setTimeout(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
      } catch (e) {}
    }, 0);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "8px 14px", background: "#0d0d1a", borderBottom: "1px solid #E879F933", flexShrink: 0 }}>
        <span style={{ color: "#E879F9", fontSize: "11px", fontFamily: "monospace" }}>🖥️ Live App Preview — interactive prototype</span>
      </div>
      <div style={{ flex: 1, background: "#0a0a0a", position: "relative" }}>
        {!html && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#1e1e35", fontSize: "13px", fontFamily: "monospace" }}>Preview appears after build completes</span>
          </div>
        )}
        <iframe ref={iframeRef} style={{ width: "100%", height: "100%", border: "none", display: html ? "block" : "none" }} title="App Preview" sandbox="allow-scripts" />
      </div>
    </div>
  );
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("idle");
  const [outputs, setOutputs] = useState({});
  const [progress, setProgress] = useState({}); // { phaseId: { current: label, done: [labels] } }
  const [activeTab, setActiveTab] = useState("database");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef(null);
  const outputsRef = useRef({});

  const appendOutput = useCallback((id, chunk) => {
    const next = (outputsRef.current[id] || "") + chunk;
    outputsRef.current[id] = next;
    setOutputs(prev => ({ ...prev, [id]: next }));
  }, []);

  const build = async () => {
    if (!prompt.trim() || status === "building") return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    outputsRef.current = {};
    setOutputs({});
    setProgress({});
    setStatus("building");
    setErrorMsg("");
    setActiveTab("database");

    try {
      for (const phase of PHASES) {
        if (ctrl.signal.aborted) break;
        setActiveTab(phase.id);
        const tasks = PHASE_TASKS[phase.id];

        for (const task of tasks) {
          if (ctrl.signal.aborted) break;
          setProgress(prev => ({
            ...prev,
            [phase.id]: {
              current: task.label,
              done: prev[phase.id]?.done || [],
            }
          }));

          // Add separator between sub-tasks
          if (outputsRef.current[phase.id]) {
            appendOutput(phase.id, "\n\n");
          }

          const systemMsg = phase.id === "preview"
            ? "You are a UI prototyper. Output only raw HTML."
            : `You are a senior ${phase.id === "database" ? "database architect" : phase.id === "backend" ? "backend engineer (Node.js/Express)" : phase.id === "frontend" ? "frontend engineer (React)" : "DevOps engineer"}. Output only code, no markdown fences, no explanation.`;

          await callAPI(systemMsg, task.prompt(prompt), ctrl.signal, (chunk) => appendOutput(phase.id, chunk));

          setProgress(prev => ({
            ...prev,
            [phase.id]: {
              current: null,
              done: [...(prev[phase.id]?.done || []), task.label],
            }
          }));
        }
      }

      if (!ctrl.signal.aborted) setStatus("done");
    } catch (err) {
      if (err.name === "AbortError") setStatus("idle");
      else { setErrorMsg(err.message); setStatus("error"); }
    }
  };

  const stop = () => { abortRef.current?.abort(); setStatus("idle"); };
  const reset = () => {
    abortRef.current?.abort();
    outputsRef.current = {};
    setOutputs({}); setProgress({}); setPrompt(""); setStatus("idle"); setErrorMsg(""); setActiveTab("database");
  };

  const isBuilding = status === "building";
  const isDone = status === "done";
  const hasOutput = Object.values(outputs).some(v => v);
  const activePhase = PHASES.find(p => p.id === activeTab);

  return (
    <div style={{ minHeight: "100vh", background: "#05050f", color: "#fff", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #0a0a15; }
        ::-webkit-scrollbar-thumb { background: #1e1e35; border-radius: 3px; }
        textarea:focus, button:focus { outline: none; }
      `}</style>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "28px 20px" }}>

        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: "700", letterSpacing: "-0.3px", marginBottom: "4px" }}>⚡ Autonomous Software Builder</h1>
          <p style={{ color: "#444", fontSize: "13px" }}>Describe your app → Database · Backend · Frontend · Deployment · Live Preview</p>
        </div>

        {/* Input */}
        <div style={{ background: "#0a0a18", border: "1px solid #1e1e35", borderRadius: "10px", padding: "16px", marginBottom: "14px" }}>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) build(); }}
            disabled={isBuilding}
            placeholder='e.g. "Food delivery app for Nairobi with M-Pesa payments, restaurant listings, and order tracking"'
            rows={2}
            style={{ width: "100%", background: "transparent", border: "none", color: "#e0e0e0", fontSize: "14px", lineHeight: "1.6", fontFamily: "inherit", resize: "none", opacity: isBuilding ? 0.5 : 1 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => !isBuilding && setPrompt(ex)}
                  style={{ background: "#0f0f1e", border: "1px solid #1e1e35", color: "#444", borderRadius: "20px", padding: "3px 10px", fontSize: "11px", cursor: isBuilding ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  onMouseEnter={e => { if (!isBuilding) { e.target.style.color="#aaa"; e.target.style.borderColor="#333"; }}}
                  onMouseLeave={e => { e.target.style.color="#444"; e.target.style.borderColor="#1e1e35"; }}
                >{ex}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {isBuilding && (
                <button onClick={stop} style={{ background: "#FF4B4B18", border: "1px solid #FF4B4B55", color: "#FF6B6B", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", fontWeight: "600" }}>■ Stop</button>
              )}
              {hasOutput && !isBuilding && (
                <button onClick={reset} style={{ background: "transparent", border: "1px solid #1e1e35", color: "#555", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>↺ New</button>
              )}
              <button onClick={build} disabled={!prompt.trim() || isBuilding} style={{
                background: prompt.trim() && !isBuilding ? "linear-gradient(135deg,#00D4AA,#0080FF)" : "#0f0f1e",
                color: prompt.trim() && !isBuilding ? "#000" : "#333",
                border: "none", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: "700",
                cursor: prompt.trim() && !isBuilding ? "pointer" : "not-allowed", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "7px", transition: "all 0.2s",
              }}>
                {isBuilding
                  ? <><span style={{ display:"inline-block", width:"11px", height:"11px", border:"2px solid #333", borderTopColor:"#00D4AA", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/> Building...</>
                  : "⚡ Build Software"}
              </button>
            </div>
          </div>
        </div>

        {/* Phase progress */}
        {(isBuilding || isDone) && (
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap", animation: "fadeIn 0.3s ease" }}>
            {PHASES.map(p => {
              const prog = progress[p.id];
              const isActive = isBuilding && !!prog?.current;
              const isDonePhase = prog && !prog.current && prog.done?.length > 0;
              const isQueued = !prog;
              const tasks = PHASE_TASKS[p.id];
              const doneCount = prog?.done?.length || 0;
              const totalCount = tasks.length;
              return (
                <div key={p.id} onClick={() => outputs[p.id] && setActiveTab(p.id)} style={{
                  flex: "1", minWidth: "100px", padding: "8px 10px",
                  background: isActive ? p.color + "18" : "#0a0a18",
                  border: "1px solid " + (isActive ? p.color + "66" : isDonePhase ? p.color + "44" : "#1a1a2e"),
                  borderRadius: "8px", cursor: outputs[p.id] ? "pointer" : "default",
                  opacity: isQueued && isBuilding ? 0.3 : 1, transition: "all 0.3s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ fontSize: "12px" }}>{p.icon}</span>
                    <span style={{ color: isActive || isDonePhase ? "#ddd" : "#333", fontSize: "11px", fontWeight: "600", flex: 1 }}>{p.label}</span>
                    {isActive && <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: p.color, animation: "blink 1s infinite" }}/>}
                    {isDonePhase && <span style={{ color: p.color, fontSize: "11px" }}>✓</span>}
                  </div>
                  {prog && (
                    <div style={{ marginTop: "5px" }}>
                      <div style={{ height: "2px", background: "#1a1a2e", borderRadius: "1px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: (doneCount / totalCount * 100) + "%", background: p.color, borderRadius: "1px", transition: "width 0.4s ease" }}/>
                      </div>
                      <div style={{ color: "#333", fontSize: "9px", fontFamily: "monospace", marginTop: "3px" }}>
                        {prog.current ? prog.current : isDonePhase ? "complete" : ""}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div style={{ background: "#FF4B4B0a", border: "1px solid #FF4B4B33", borderRadius: "8px", padding: "12px 14px", marginBottom: "12px", color: "#FF7B7B", fontSize: "12px", fontFamily: "monospace" }}>
            ✗ {errorMsg}
            <button onClick={reset} style={{ marginLeft: "10px", background: "transparent", border: "1px solid #FF4B4B44", color: "#FF4B4B", borderRadius: "4px", padding: "1px 8px", fontSize: "11px", cursor: "pointer" }}>retry</button>
          </div>
        )}

        {/* Tabs + Output */}
        {hasOutput && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div style={{ display: "flex", gap: "2px", borderBottom: "1px solid #1a1a2e" }}>
              {PHASES.map(p => {
                const hasContent = !!outputs[p.id];
                const isActive = activeTab === p.id;
                const prog = progress[p.id];
                const clickable = hasContent;
                return (
                  <button key={p.id} onClick={() => clickable && setActiveTab(p.id)} style={{
                    background: isActive ? "#0a0a18" : "transparent",
                    border: "1px solid " + (isActive ? p.color + "55" : "transparent"),
                    borderBottom: isActive ? "1px solid #0a0a18" : "1px solid transparent",
                    borderRadius: "7px 7px 0 0", marginBottom: "-1px",
                    color: isActive ? "#fff" : clickable ? "#555" : "#1e1e35",
                    padding: "8px 14px", fontSize: "12px",
                    cursor: clickable ? "pointer" : "not-allowed",
                    fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px", transition: "all 0.15s",
                  }}>
                    {p.icon} {p.label}
                    {prog?.current && <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: p.color, animation: "blink 1s infinite" }}/>}
                  </button>
                );
              })}
            </div>

            <div style={{ height: "520px", background: "#070710", border: "1px solid #1a1a2e", borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
              {activeTab === "preview"
                ? <PreviewPanel html={outputs["preview"] || ""} />
                : (() => {
                    const p = PHASES.find(x => x.id === activeTab);
                    const prog = progress[p?.id];
                    return p
                      ? <CodePanel content={outputs[p.id] || ""} color={p.color} phase={p} subLabel={prog?.current} />
                      : null;
                  })()
              }
            </div>
          </div>
        )}

        {isDone && (
          <div style={{ marginTop: "12px", padding: "12px 16px", background: "#00D4AA08", border: "1px solid #00D4AA33", borderRadius: "8px", display: "flex", alignItems: "center", gap: "10px", animation: "fadeIn 0.4s ease" }}>
            <span>✅</span>
            <div>
              <span style={{ color: "#00D4AA", fontWeight: "600", fontSize: "13px" }}>Build complete. </span>
              <span style={{ color: "#555", fontSize: "12px" }}>Click 🖥️ Live Preview to interact with your app prototype.</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
