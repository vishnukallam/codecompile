import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Configure Monaco to use CDN for stability and avoid "Unexpected token <" errors
loader.config({
  paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }
});

declare global {
  interface Window {
    loadPyodide: any;
  }
}

type Language = 'python' | 'java';
type Theme = 'dark' | 'light';

const templates: Record<Language, string> = {
  python: `import math\nprint(f"Square root of 16 is: {math.sqrt(16)}")\n# Try 'import requests' to see cloud installation!`,
  java: `class Main {
    public static void main(String[] args) {
        System.out.println("Hello World!");
    }
}`
};

const versions: Record<Language, string[]> = {
  python: ['3.11'],
  java: ['17.0.8']
};

const themeConfig = {
  dark: {
    bg: '#020202',
    surface: '#080808',
    accent: '#47cf73',
    text: '#ffffff',
    textMuted: '#a0a0a0',
    headerBg: '#050505',
    buttonColor: '#ffffff',
    border: '#1a1a1a',
    shadow: 'rgba(0,0,0,0.8)',
    editorTheme: 'vs-dark'
  },
  light: {
    bg: '#f8f9fa',
    surface: '#ffffff',
    accent: '#2196F3',
    text: '#202124',
    textMuted: '#5f6368',
    headerBg: '#ffffff',
    buttonColor: '#ffffff',
    border: '#dadce0',
    shadow: 'rgba(0,0,0,0.1)',
    editorTheme: 'light'
  }
};

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const savedLang = sessionStorage.getItem('selected_language') as Language;
    return savedLang || 'python';
  });
  const [theme, setTheme] = useState<Theme>('dark');
  const [code, setCode] = useState(() => {
    const savedLang = sessionStorage.getItem('selected_language') as Language || 'python';
    const savedCode = sessionStorage.getItem(`code_${savedLang}`);
    return savedCode || templates[savedLang];
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [pyodide, setPyodide] = useState<any>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xterm = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  const colors = themeConfig[theme];

  // Persistence: Save code and language to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(`code_${language}`, code);
    sessionStorage.setItem('selected_language', language);
  }, [code, language]);

  // Initialize Terminal
  useLayoutEffect(() => {
    if (!terminalRef.current) return;
    if (xterm.current) return; // Prevent double initialization

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: theme === 'dark' ? '#1e1e1e' : '#ffffff',
        foreground: theme === 'dark' ? '#ffffff' : '#202124',
        cursor: theme === 'dark' ? '#47cf73' : '#2196F3',
      },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      rows: 20,
      convertEol: true
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);

    xterm.current = term;
    fitAddon.current = fit;

    // Use a slight delay to ensure the container is rendered and measurable
    const timer = setTimeout(() => {
      if (fitAddon.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
        try {
          fitAddon.current.fit();
        } catch (e) {
          console.warn("Initial fit failed:", e);
        }
      }
    }, 200);

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && terminalRef.current && terminalRef.current.offsetWidth > 0) {
        try {
          fitAddon.current.fit();
        } catch (e) {
          // Terminal might not be visible yet
        }
      }
    });

    resizeObserver.observe(terminalRef.current);

    term.writeln('\x1b[1;32mOnline Compiler Ready\x1b[0m');

    const initPyodide = async () => {
      try {
        term.writeln('Connecting to Execution Cloud...');

        let retryCount = 0;
        while (!window.loadPyodide && retryCount < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          retryCount++;
        }

        if (!window.loadPyodide) {
          term.writeln('\x1b[31mError: Cloud Script (Pyodide) failed to load. Check your internet connection.\x1b[0m');
          setIsInitializing(false);
          return;
        }

        const py = await window.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
        });
        setPyodide(py);
        setIsInitializing(false);
        term.writeln('\x1b[32mEnvironment Ready. Cloud packages fully supported.\x1b[0m');
      } catch (err) {
        term.writeln(`\x1b[31mError initializing: ${err}\x1b[0m`);
        setIsInitializing(false);
      }
    };

    initPyodide();

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      term.dispose();
      xterm.current = null;
      fitAddon.current = null;
    };
  }, []);

  // Handle Theme Shifts
  useEffect(() => {
    if (xterm.current) {
      xterm.current.options.theme = {
        background: theme === 'dark' ? '#1e1e1e' : '#ffffff',
        foreground: theme === 'dark' ? '#ffffff' : '#202124',
        cursor: theme === 'dark' ? '#47cf73' : '#2196F3',
      };
    }
  }, [theme]);

  const runPython = async () => {
    if (!pyodide) return;
    setIsRunning(true);
    xterm.current?.clear();
    xterm.current?.writeln('Starting Cloud Process...');

    try {
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");

      pyodide.setStdout({ batched: (str: string) => xterm.current?.write('\x1b[36m' + str + '\x1b[0m\n') });
      pyodide.setStderr({ batched: (str: string) => xterm.current?.write('\x1b[31m' + str + '\x1b[0m\n') });

      // Detect and install Cloud Packages
      const imports = code.match(/(?:^|\n)(?:from|import)\s+([a-zA-Z0-9_]+)/g);
      if (imports) {
        for (const imp of imports) {
          const mod = imp.trim().split(/\s+/)[1];
          const standardLibs = ['sys', 'os', 'math', 'json', 're', 'datetime', 'time', 'random'];
          if (mod && !standardLibs.includes(mod)) {
            xterm.current?.writeln(`Cloud: Installing [${mod}]...`);
            try {
              await micropip.install(mod);
            } catch (e) {
              // Mod might be standard or unavailable, pyodide will handle it during run
            }
          }
        }
      }

      await pyodide.runPythonAsync(code);
      xterm.current?.writeln('\r\n\x1b[32mExecution Success\x1b[0m');
    } catch (err: any) {
      xterm.current?.write('\x1b[31m' + err.toString() + '\x1b[0m\n');
    } finally {
      setIsRunning(false);
    }
  };

  const runJava = async () => {
    setIsRunning(true);
    xterm.current?.clear();
    xterm.current?.writeln('Compiling via Cloud API (Judge0)...');

    try {
      const response = await fetch('https://ce.judge0.com/submissions?base64_encoded=false&wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_code: code,
          language_id: 62, // Java (OpenJDK 13.0.1)
          stdin: ""
        })
      });

      const data = await response.json();
      if (data.stdout || data.stderr || data.compile_output) {
        if (data.stdout) xterm.current?.write('\x1b[36m' + data.stdout + '\x1b[0m');
        if (data.stderr) xterm.current?.write('\x1b[31m' + data.stderr + '\x1b[0m');
        if (data.compile_output) xterm.current?.write('\x1b[31m' + data.compile_output + '\x1b[0m');
        xterm.current?.writeln(`\r\n\x1b[32mProcess Finished (Status: ${data.status.description})\x1b[0m`);
      } else {
        xterm.current?.writeln('\x1b[31mNo output received from cloud.\x1b[0m');
      }
    } catch (err: any) {
      xterm.current?.writeln('\r\n\x1b[31mNetwork Error: ' + err.message + '\x1b[0m');
    } finally {
      setIsRunning(false);
    }
  };

  const runCode = () => {
    if (language === 'python') runPython();
    else runJava();
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const handleEditorDidMount = (editor: any, monaco: any) => {
    // Configure Python language defaults
    if (monaco?.languages?.python) {
      monaco.languages.python.pythonDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });

      // Provide extra library definitions for common Python modules
      const pythonLibSource = `
declare class math {
    static ceil(x: number): number;
    static floor(x: number): number;
    static sqrt(x: number): number;
    static pi: number;
    static sin(x: number): number;
    static cos(x: number): number;
}
declare class os {
    static getcwd(): string;
    static listdir(path?: string): string[];
}
declare class sys {
    static version: string;
    static path: string[];
}
      `;

      monaco.languages.python.pythonDefaults.setExtraLibs([
        { content: pythonLibSource, filePath: 'lib.python.d.ts' }
      ]);
    }

    // Configure Java language defaults
    if (monaco?.languages?.java) {
      const javaLibSource = `
declare namespace java.util {
    class ArrayList<E> {
        add(e: E): boolean;
        get(index: number): E;
        size(): number;
    }
    class HashMap<K, V> {
        put(key: K, value: V): V;
        get(key: any): V;
        size(): number;
    }
}
declare class System {
    static out: {
        println(s: any): void;
        print(s: any): void;
    };
}
      `;

      monaco.languages.java.javaDefaults.setExtraLibs([
        { content: javaLibSource, filePath: 'lib.java.d.ts' }
      ]);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      backgroundColor: colors.bg, color: colors.text,
      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden'
    }}>
      {/* Global Style Overrides for Premium UI */}
      <style>{`
        .premium-gradient-title {
          background: linear-gradient(45deg, ${colors.accent}, #00d2ff) !important;
          -webkit-background-clip: text !important;
          background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          color: transparent !important;
          display: inline-block !important;
          width: fit-content !important;
        }
      `}</style>

      {/* Premium Header */}
      <header style={{
        height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px', backgroundColor: colors.headerBg,
        borderBottom: `1px solid ${colors.border}`, zIndex: 10,
        boxShadow: `0 2px 10px ${colors.shadow}`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '25px' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.6rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center'
          }}>
            <span className="premium-gradient-title">
              Online Compiler
            </span>
          </h1>

          <div style={{ display: 'flex', gap: '12px' }}>
            <select
              value={language}
              onChange={(e) => {
                const lang = e.target.value as Language;
                setLanguage(lang);
                const savedCode = sessionStorage.getItem(`code_${lang}`);
                setCode(savedCode || templates[lang]);
                xterm.current?.clear();
              }}
              style={{
                padding: '10px 20px', borderRadius: '10px', backgroundColor: colors.surface,
                color: colors.text, border: `1px solid ${colors.border}`, cursor: 'pointer',
                fontWeight: 700, outline: 'none', transition: 'box-shadow 0.2s',
                boxShadow: `0 2px 4px ${colors.shadow}`
              }}
              onFocus={(e) => e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.accent}`}
              onBlur={(e) => e.currentTarget.style.boxShadow = `0 2px 4px ${colors.shadow}`}
            >
              <option value="python">Python 3</option>
              <option value="java">Java 13</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {/* Minimalist Pill-Style Theme Toggle Switch */}
          <div
            onClick={toggleTheme}
            style={{
              width: '56px', height: '28px',
              backgroundColor: theme === 'dark' ? '#2c3e50' : '#bdc3c7',
              borderRadius: '20px', position: 'relative', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              transition: 'background-color 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            {/* The clean theme-aware thumb circle */}
            <div style={{
              width: '22px', height: '22px',
              backgroundColor: theme === 'dark' ? '#fff' : '#333',
              borderRadius: '50%',
              position: 'absolute', left: theme === 'dark' ? '30px' : '4px',
              transition: 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              zIndex: 2
            }}>
            </div>
          </div>

          <button
            onClick={runCode}
            disabled={isInitializing || isRunning}
            style={{
              backgroundColor: colors.accent, color: 'white', border: 'none',
              padding: '12px 32px', cursor: (isInitializing || isRunning) ? 'not-allowed' : 'pointer',
              borderRadius: '10px', fontWeight: 800, fontSize: '1rem',
              transition: 'all 0.2s', opacity: (isInitializing || isRunning) ? 0.7 : 1,
              boxShadow: isRunning ? 'none' : `0 4px 15px rgba(71, 207, 115, 0.4)`,
              transform: isRunning ? 'scale(0.98)' : 'scale(1)'
            }}
            onMouseOver={(e) => !isRunning && (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseOut={(e) => !isRunning && (e.currentTarget.style.transform = 'translateY(0)')}
          >
            {isRunning ? 'EXECUTING...' : isInitializing ? 'PREPARING...' : 'RUN CODE'}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: '15px', gap: '15px' }}>
        {/* Editor Container */}
        <div style={{
          flex: 1.2, borderRadius: '15px', overflow: 'hidden',
          backgroundColor: colors.surface,
          boxShadow: theme === 'light'
            ? '0 10px 25px rgba(0,0,0,0.05), 0 20px 48px rgba(0,0,0,0.05), 0 1px 4px rgba(0,0,0,0.1)'
            : `0 8px 32px ${colors.shadow}`,
          border: `1px solid ${colors.border}`,
          position: 'relative',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <Editor
            height="100%"
            language={language}
            theme={colors.editorTheme}
            value={code}
            onMount={handleEditorDidMount}
            onChange={(value) => setCode(value || '')}
            options={{
              minimap: { enabled: false }, fontSize: 15, padding: { top: 20 },
              scrollBeyondLastLine: false, automaticLayout: true,
              fontFamily: '"Fira Code", monospace', cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on', renderLineHighlight: 'all',
              lineHeight: 1.6, lineNumbers: 'on',
              scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              parameterHints: { enabled: true },
              wordBasedSuggestions: true as any,
              formatOnType: true,
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              tabSize: 4,
              insertSpaces: true
            }}
          />
        </div>

        {/* Terminal Container */}
        <div style={{
          flex: 0.8, display: 'flex', flexDirection: 'column',
          borderRadius: '15px', overflow: 'hidden',
          backgroundColor: colors.surface,
          boxShadow: theme === 'light'
            ? '0 10px 25px rgba(0,0,0,0.05), 0 20px 48px rgba(0,0,0,0.05), 0 1px 4px rgba(0,0,0,0.1)'
            : `0 8px 32px ${colors.shadow}`,
          border: `1px solid ${colors.border}`,
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <div style={{
            height: '40px', display: 'flex', alignItems: 'center', padding: '0 20px',
            backgroundColor: colors.headerBg, borderBottom: `1px solid ${colors.border}`,
            fontSize: '0.75rem', fontWeight: 800, color: colors.textMuted, letterSpacing: '1px'
          }}>
            SYSTEM TERMINAL
          </div>
          <div ref={terminalRef} style={{ flex: 1, padding: '15px' }} />
        </div>
      </div>

      {/* Global CSS for scrollbar removal */}
      <style>{`
        body { margin: 0; padding: 0; overflow: hidden !important; }
        * { -ms-overflow-style: none; scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

export default App;
