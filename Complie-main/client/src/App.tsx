import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Declare global for Pyodide
declare global {
  interface Window {
    loadPyodide: any;
  }
}

type Language = 'python' | 'java';
type Theme = 'dark' | 'light';

const templates: Record<Language, string> = {
  python: `print("Welcome to Code Compiler.")`,
  java: `class Main {
    public static void main(String[] args) {
        System.out.println("Welcome to Code Compiler.");
    }
}`
};



const themeConfig = {
  dark: {
    bg: '#121212',
    surface: '#1e1e1e',
    accent: '#47cf73',
    text: '#ffffff',
    textMuted: '#a0a0a0',
    headerBg: '#1a1a1a',
    buttonColor: '#ffffff',
    border: '#333333',
    shadow: 'rgba(0,0,0,0.5)',
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
    shadow: 'rgba(0,0,0,0.06)',
    editorTheme: 'light',
    premiumShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)'
  }
};

const getFileName = (lang: string) => {
  switch (lang) {
    case 'python': return 'main.py';
    case 'java': return 'Main.java';
    default: return 'main.txt';
  }
};

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    return (sessionStorage.getItem('last_language') as Language) || 'python';
  });
  const [theme, setTheme] = useState<Theme>('dark');
  const [code, setCode] = useState(() => {
    const lastLang = (sessionStorage.getItem('last_language') as Language) || 'python';
    const savedCode = sessionStorage.getItem(`code_${lastLang}`);
    return savedCode || templates[lastLang];
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [pyodide, setPyodide] = useState<any>(null);
  const [outputTab, setOutputTab] = useState<'terminal' | 'visuals'>('terminal');
  const [plotImage, setPlotImage] = useState<string | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xterm = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  const colors = themeConfig[theme];

  // Persistence: Save code to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem(`code_${language}`, code);
  }, [code, language]);

  // Special fix for corrupted Java sessionStorage from previous race condition
  useEffect(() => {
    const javaCode = sessionStorage.getItem('code_java');
    if (javaCode === templates.python) {
      sessionStorage.setItem('code_java', templates.java);
      if (language === 'java') {
        setCode(templates.java);
      }
    }
  }, [language]);

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
        selectionBackground: '#2196F380',
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

    term.writeln('\x1b[1;32mCode Compiler Ready\x1b[0m');

    const initPyodide = async () => {
      try {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle Theme Shifts
  useEffect(() => {
    if (xterm.current) {
      xterm.current.options.theme = {
        background: theme === 'dark' ? '#1e1e1e' : '#ffffff',
        foreground: theme === 'dark' ? '#ffffff' : '#202124',
        cursor: theme === 'dark' ? '#47cf73' : '#2196F3',
        selectionBackground: '#2196F380',
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
      pyodide.setStderr({ batched: (str: string) => xterm.current?.write('\x1b[33m' + str + '\x1b[0m\n') });

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

      // Check for matplotlib usage to prepare canvas
      const hasMatplotlib = code.includes('matplotlib') || code.includes('plt.');
      if (hasMatplotlib) {
        setPlotImage(null);
        await pyodide.runPythonAsync(`
import io, base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
`);
      }

      await pyodide.runPythonAsync(code);

      // Extract plot if matplotlib was used
      if (hasMatplotlib) {
        const plotData = await pyodide.runPythonAsync(`
import io, base64
buf = io.BytesIO()
plt.savefig(buf, format='png')
buf.seek(0)
img_str = 'data:image/png;base64,' + base64.b64encode(buf.read()).decode('UTF-8')
plt.close()
img_str
`);
        if (plotData && plotData.length > 30) {
          setPlotImage(plotData);
          setOutputTab('visuals');
        }
      }

      xterm.current?.writeln('\r\n\x1b[32mExecution Success\x1b[0m');
    } catch (err: any) {
      xterm.current?.write('\x1b[1;33m' + err.toString() + '\x1b[0m\n');
    } finally {
      setIsRunning(false);
    }
  };

  // Wraps Java Swing/AWT code to run in headless mode via BufferedImage
  const wrapJavaForHeadless = (javaCode: string): string => {
    const classMatch = javaCode.match(/public\s+class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : 'Main';
    const paintMatch = javaCode.match(/void\s+paintComponent\s*\(Graphics\s+\w+\)\s*\{([\s\S]*?)(?=\n\s*\}(?:\s*\n\s*\}))/);
    const paintBody = paintMatch ? paintMatch[1].replace(/super\.paintComponent\(\w+\);?/, '').trim() : '';
    const wMatch = javaCode.match(/setSize\s*\(\s*(\d+)\s*,\s*(\d+)/);
    const imgW = wMatch ? wMatch[1] : '600';
    const imgH = wMatch ? wMatch[2] : '400';
    return `import java.awt.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.ByteArrayOutputStream;
import java.util.Base64;

public class ${className} {
    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");
        BufferedImage img = new BufferedImage(${imgW}, ${imgH}, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = img.createGraphics();
        g2.setColor(new Color(30, 30, 30));
        g2.fillRect(0, 0, ${imgW}, ${imgH});
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        ${paintBody}
        g2.dispose();
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "PNG", baos);
        System.out.println("VISUAL_OUTPUT:" + Base64.getEncoder().encodeToString(baos.toByteArray()));
    }
}`;
  };

  const runJava = async () => {
    setIsRunning(true);
    xterm.current?.clear();
    xterm.current?.writeln('Starting Cloud Process (Java)...');

    try {
      let processedCode = code.replace(/^[ \t]*package[ \t]+[a-zA-Z0-9._]+[ \t]*;/gm, '');
      const isGuiCode = /paintComponent|Graphics2D|fillRect|drawString|setColor|drawOval|drawLine|JFrame|JPanel/.test(code);

      if (isGuiCode) {
        xterm.current?.writeln('\x1b[33mGUI code detected — rendering in headless mode...\x1b[0m');
        processedCode = wrapJavaForHeadless(code);
      }

      const base64Code = btoa(unescape(encodeURIComponent(processedCode)));
      const response = await fetch('https://ce.judge0.com/submissions?base64_encoded=true&wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ source_code: base64Code, language_id: 62, stdin: "" })
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();
      const stdout = data.stdout ? decodeURIComponent(escape(atob(data.stdout))) : '';
      const stderr = data.stderr ? decodeURIComponent(escape(atob(data.stderr))) : '';
      const compile_output = data.compile_output ? decodeURIComponent(escape(atob(data.compile_output))) : '';
      const status = data.status?.description || 'Completed';

      if (stdout) {
        // --- Multi-pattern Visual Detection ---
        // Pattern 1: our own VISUAL_OUTPUT: marker
        const hasVisualMarker = stdout.includes('VISUAL_OUTPUT:');
        // Pattern 2: raw data URI from user-written Java code  
        const hasDataUri = stdout.includes('data:image/png;base64,') || stdout.includes('data:image/svg+xml;base64,');

        if (hasVisualMarker || hasDataUri) {
          let imageDataUri = '';

          if (hasVisualMarker) {
            const raw = stdout.substring(stdout.indexOf('VISUAL_OUTPUT:') + 'VISUAL_OUTPUT:'.length).trim();
            imageDataUri = `data:image/png;base64,${raw}`;
          } else {
            // Extract the raw data URI from the stdout — handle multi-line output
            const lines = stdout.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:image/')) {
                imageDataUri = trimmed;
                break;
              }
              // Also handle: System.out.println("data:image/png;base64," + base64String)
              const dataIdx = trimmed.indexOf('data:image/');
              if (dataIdx !== -1) {
                imageDataUri = trimmed.substring(dataIdx);
                break;
              }
            }
          }

          if (imageDataUri) {
            setPlotImage(imageDataUri);
            setOutputTab('visuals');
            xterm.current?.writeln('\x1b[32mVisualization rendered in Visuals tab.\x1b[0m');
          } else {
            xterm.current?.write('\x1b[36m' + stdout + '\x1b[0m');
          }
        } else {
          xterm.current?.write('\x1b[36m' + stdout + '\x1b[0m');
          // Smart Visualizer for ASCII bar charts
          const barLines = stdout.split('\n').filter(line => /\w.*\|.*[|#*=]/.test(line));
          if (barLines.length >= 2) {
            const chartData = barLines.map(line => {
              const parts = line.split('|');
              return { label: parts[0].trim(), value: parts[1] ? parts[1].trim().length : 0 };
            }).filter(d => d.value > 0 && d.label.length > 0);
            if (chartData.length >= 2) {
              const maxVal = Math.max(...chartData.map(d => d.value));
              const svgH = chartData.length * 44 + 60;
              const svg = `<svg width="500" height="${svgH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#1e1e1e" rx="8"/><text x="20" y="30" fill="#47cf73" font-family="monospace" font-size="14" font-weight="bold">Java Console Visualizer</text>${chartData.map((d, i) => `<text x="15" y="${62 + i * 44}" fill="#a0a0a0" font-family="monospace" font-size="12">${d.label.substring(0, 14)}</text><rect x="130" y="${48 + i * 44}" width="${(d.value / maxVal) * 330}" height="22" fill="#47cf73" rx="4" opacity="0.85"/><text x="${140 + (d.value / maxVal) * 330}" y="${64 + i * 44}" fill="#fff" font-family="monospace" font-size="11">${d.value}</text>`).join('')}</svg>`;
              setPlotImage('data:image/svg+xml;base64,' + btoa(svg));
              setOutputTab('visuals');
            }
          }
        }
      }

      if (stderr) xterm.current?.write('\x1b[33m' + stderr + '\x1b[0m');
      if (compile_output) xterm.current?.write('\x1b[1;33m' + compile_output + '\x1b[0m');
      if (!stdout && !stderr && !compile_output) xterm.current?.writeln('\x1b[1;33mProcess finished with no output.\x1b[0m');
      xterm.current?.writeln(`\r\n\x1b[32mProcess Finished (Status: ${status})\x1b[0m`);
    } catch (err: any) {
      xterm.current?.writeln('\r\n\x1b[1;31mExecution Error: ' + err.message + '\x1b[0m');
      xterm.current?.writeln('\x1b[1;33mPlease check your network connection or try again.\x1b[0m');
    } finally {
      setIsRunning(false);
    }
  };

  const runCode = () => {
    setOutputTab('terminal');
    if (language === 'python') runPython();
    else if (language === 'java') runJava();
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const copyTerminalOutput = () => {
    if (xterm.current) {
      xterm.current.selectAll();
      const selection = xterm.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        xterm.current.clearSelection();
        // Optional: Provide visual feedback
        xterm.current.writeln('\x1b[1;32m\r\nOutput Copied to Clipboard!\x1b[0m');
      }
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      backgroundColor: colors.bg, color: colors.text,
      transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)', overflow: 'hidden'
    }}>
      {/* Global Style Overrides for Premium UI */}
      <style>{`
        .premium-gradient-title {
          color: ${theme === 'light' ? '#000000' : colors.accent} !important;
          text-shadow: ${theme === 'light' ? 'none' : `0 0 10px ${colors.accent}, 0 0 20px ${colors.accent}44`} !important;
          animation: ${theme === 'light' ? 'none' : 'titleGlow 3s ease-in-out infinite alternate'} !important;
          display: inline-block !important;
        }
        @keyframes titleGlow {
          from { text-shadow: 0 0 5px ${colors.accent}, 0 0 10px ${colors.accent}22; }
          to { text-shadow: 0 0 15px ${colors.accent}, 0 0 30px ${colors.accent}88; }
        }
        .stylish-c-1 {
          font-family: "Playfair Display", serif !important;
          font-style: italic !important;
          font-weight: 900 !important;
          font-size: 1.2em !important;
          margin-right: -1px !important;
          color: ${theme === 'light' ? '#000000' : colors.accent} !important;
        }
        .stylish-c-2 {
          font-family: "Georgia", serif !important;
          font-style: italic !important;
          font-weight: 900 !important;
          font-size: 1.1em !important;
          margin-right: -1px !important;
          color: ${theme === 'light' ? '#000000' : colors.accent} !important;
        }
      `}</style>

      {/* Premium Header */}
      <header style={{
        height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px', backgroundColor: colors.headerBg,
        borderBottom: `1px solid ${colors.border}`, zIndex: 10,
        boxShadow: `0 2px 10px ${colors.shadow}`,
        transition: 'all 0.4s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '25px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h1 style={{
              margin: 0,
              fontSize: '1.6rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center'
            }}>
              <span className="premium-gradient-title">
                <span className="stylish-c-1">C</span>ode <span className="stylish-c-2">C</span>ompiler
              </span>
            </h1>
            <button
              onClick={() => setIsAboutOpen(true)}
              style={{
                background: 'none', color: colors.accent,
                fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                padding: '5px 10px', borderRadius: '6px', transition: 'all 0.3s',
                border: `1px solid ${colors.accent}44`
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = `${colors.accent}11`;
                e.currentTarget.style.borderColor = colors.accent;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = `${colors.accent}44`;
              }}
            >
              About
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <select
              value={language}
              onChange={(e) => {
                const lang = e.target.value as Language;
                setLanguage(lang);
                sessionStorage.setItem('last_language', lang);

                const savedCode = sessionStorage.getItem(`code_${lang}`);
                if (savedCode) {
                  setCode(savedCode);
                } else {
                  setCode(templates[lang]);
                }

                xterm.current?.clear();
                setOutputTab('terminal');
              }}
              style={{
                padding: '10px 20px', borderRadius: '10px', backgroundColor: colors.surface,
                color: colors.text, border: `1px solid ${colors.border}`, cursor: 'pointer',
                fontWeight: 700, outline: 'none', transition: 'all 0.3s ease',
                boxShadow: `0 2px 4px ${colors.shadow}`
              }}
              onFocus={(e) => e.currentTarget.style.boxShadow = `0 0 0 2px ${theme === 'light' ? '#2196F3' : '#47cf73'}`}
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
              backgroundColor: '#0056b3', color: 'white', border: 'none',
              padding: '8px 20px', cursor: (isInitializing || isRunning) ? 'not-allowed' : 'pointer',
              borderRadius: '6px', fontWeight: 600, fontSize: '0.9rem',
              transition: 'all 0.3s ease', opacity: (isInitializing || isRunning) ? 0.7 : 1,
              display: 'flex', alignItems: 'center', gap: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            {isRunning ? (
              'EXECUTING...'
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Run
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: '15px', gap: '15px' }}>
        {/* Editor Container */}
        <div style={{
          flex: 1.2, borderRadius: '12px', overflow: 'hidden',
          backgroundColor: theme === 'light' ? '#ffffff' : colors.surface,
          boxShadow: theme === 'light'
            ? '0 4px 20px rgba(0,0,0,0.08)'
            : `0 8px 32px ${colors.shadow}`,
          border: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column',
          transition: 'all 0.4s ease'
        }}>
          {/* Filename Tab */}
          <div style={{
            height: '40px', display: 'flex', alignItems: 'center',
            backgroundColor: theme === 'light' ? '#f0f2f5' : '#1a1a1a',
            borderBottom: `1px solid ${colors.border}`
          }}>
            <div style={{
              height: '100%', padding: '0 20px', display: 'flex', alignItems: 'center',
              backgroundColor: theme === 'light' ? '#ffffff' : colors.surface,
              borderRight: `1px solid ${colors.border}`,
              fontSize: '0.85rem', fontWeight: 600, color: colors.text
            }}>
              {getFileName(language)}
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative' }}>
            <Editor
              height="100%"
              language={language}
              theme={colors.editorTheme}
              value={code}
              onChange={(value) => setCode(value || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 15,
                padding: { top: 20 },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: '"Fira Code", monospace',
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                renderLineHighlight: 'all',
                lineHeight: 1.6,
                lineNumbers: 'on',
                scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
                quickSuggestions: { other: true, comments: true, strings: true },
                quickSuggestionsDelay: 0,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'on',
                tabCompletion: 'on',
                parameterHints: { enabled: true },
                formatOnType: true,
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                autoClosingOvertype: 'always',
                autoIndent: 'advanced',
                wordBasedSuggestions: 'allDocuments',
                suggest: {
                  showFunctions: true,
                  showKeywords: true,
                  showModules: true,
                  showSnippets: true,
                  showClasses: true,
                  showColors: true,
                  showConstants: true,
                  showConstructors: true,
                  showEvents: true,
                  showFields: true,
                  showFiles: true,
                  showFolders: true,
                  showInterfaces: true,
                  showIssues: true,
                  showMethods: true,
                  showOperators: true,
                  showProperties: true,
                  showReferences: true,
                  showStructs: true,
                  showTypeParameters: true,
                  showUnits: true,
                  showUsers: true,
                  showValues: true,
                  showVariables: true,
                  showWords: true
                }
              }}
            />
          </div>
        </div>

        {/* Terminal Container */}
        <div style={{
          flex: 0.8, display: 'flex', flexDirection: 'column',
          borderRadius: '15px', overflow: 'hidden',
          backgroundColor: colors.surface,
          boxShadow: theme === 'light'
            ? '0 10px 30px -5px rgba(0, 0, 0, 0.1), 0 8px 15px -6px rgba(0, 0, 0, 0.05)'
            : `0 8px 32px ${colors.shadow}`,
          border: `1px solid ${colors.border}`,
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
          <div style={{
            height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 10px', backgroundColor: theme === 'light' ? '#f0f2f5' : '#1a1a1a',
            borderBottom: `1px solid ${colors.border}`,
            transition: 'all 0.4s ease'
          }}>
            <div style={{ display: 'flex', gap: '5px', height: '100%' }}>
              <button
                onClick={() => setOutputTab('terminal')}
                style={{
                  padding: '0 15px', border: 'none', background: 'none',
                  color: outputTab === 'terminal' ? colors.accent : colors.textMuted,
                  fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer',
                  borderBottom: outputTab === 'terminal' ? `2px solid ${colors.accent}` : 'none',
                  transition: 'all 0.3s'
                }}
              >
                TERMINAL
              </button>
              {(language === 'python' || language === 'java') && (
                <button
                  onClick={() => setOutputTab('visuals')}
                  style={{
                    padding: '0 15px', border: 'none', background: 'none',
                    color: outputTab === 'visuals' ? colors.accent : colors.textMuted,
                    fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer',
                    borderBottom: outputTab === 'visuals' ? `2px solid ${colors.accent}` : 'none',
                    transition: 'all 0.3s'
                  }}
                >
                  VISUALS {plotImage && '●'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={copyTerminalOutput}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: `1px solid ${colors.border}`,
                  backgroundColor: colors.surface, color: colors.text, cursor: 'pointer',
                  fontSize: '0.7rem', fontWeight: 700, transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme === 'light' ? '#f8f9fa' : '#2a2a2a'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.surface}
              >
                COPY
              </button>
              <button
                onClick={() => xterm.current?.clear()}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: `1px solid ${colors.border}`,
                  backgroundColor: colors.surface, color: colors.text, cursor: 'pointer',
                  fontSize: '0.7rem', fontWeight: 700, transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = theme === 'light' ? '#f8f9fa' : '#2a2a2a'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = colors.surface}
              >
                CLEAR
              </button>
            </div>
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              visibility: outputTab === 'terminal' ? 'visible' : 'hidden',
              padding: '15px'
            }} ref={terminalRef} />

            {outputTab === 'visuals' && (
              <div style={{
                height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#1e1e1e', // Always dark to match terminal experience
                padding: '20px'
              }}>
                {plotImage ? (
                  <img
                    src={plotImage}
                    alt="Python Plot"
                    style={{
                      maxWidth: '100%', maxHeight: '100%',
                      borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global CSS for scrollbar removal */}
      <style>{`
        body { margin: 0; padding: 0; overflow: hidden !important; }
        * { -ms-overflow-style: none; scrollbar-width: none; }
        *::-webkit-scrollbar { display: none; }
      `}</style>
      {/* About Modal */}
      {isAboutOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(8px)', animation: 'fadeIn 0.3s ease'
        }} onClick={() => setIsAboutOpen(false)}>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
          `}</style>
          <div style={{
            width: '90%', maxWidth: '700px', maxHeight: '85vh',
            backgroundColor: colors.surface, borderRadius: '24px',
            padding: '40px', position: 'relative', overflowY: 'auto',
            boxShadow: `0 25px 50px -12px ${colors.shadow}`,
            border: `1px solid ${colors.border}`,
            animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            color: colors.text
          }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setIsAboutOpen(false)}
              style={{
                position: 'absolute', top: '20px', right: '20px',
                background: 'none', border: 'none', color: colors.textMuted,
                fontSize: '1.5rem', cursor: 'pointer', transition: 'color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = colors.text}
              onMouseOut={(e) => e.currentTarget.style.color = colors.textMuted}
            >
              ×
            </button>

            <h2 style={{ fontSize: '2rem', marginBottom: '20px' }}>
              <span className="premium-gradient-title">
                About <span className="stylish-c-1">C</span>ode <span className="stylish-c-2">C</span>ompiler
              </span>
            </h2>

            <section style={{ marginBottom: '30px' }}>
              <p style={{ lineHeight: 1.6, fontSize: '1.1rem', opacity: 0.9 }}>
                Code Compiler is a high-performance, browser-based development environment designed for speed,
                versatility, and a premium user experience. It allows you to write, compile, and execute
                code in real-time without any local setup.
              </p>
            </section>

            <div style={{ marginBottom: '30px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '15px' }}>🚀 Key Features</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.8 }}>
                  <li>✨ <strong>Multi-Language:</strong> Python 3 and Java 13 support.</li>
                  <li>📊 <strong>Visualizations:</strong> Built-in Matplotlib support for plots.</li>
                  <li>💾 <strong>Persistence:</strong> Auto-saves your code to browser sessions.</li>
                  <li>🎨 <strong>Theming:</strong> Beautiful Dark and Light mode options.</li>
                </ul>
              </div>
            </div>

            <section style={{
              padding: '20px', backgroundColor: theme === 'dark' ? '#252525' : '#f8f9fa',
              borderRadius: '16px', border: `1px solid ${colors.border}`
            }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '10px' }}>Our Mission</h3>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.6, opacity: 0.8 }}>
                To empower developers and students everywhere by providing an accessible,
                stunning, and powerful tool to experiment with code anywhere, at any time.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
