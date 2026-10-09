from pathlib import Path

def edit(path, old, new, count=1):
    p=Path(path); text=p.read_text()
    assert text.count(old)==count,(path,text.count(old),old[:120])
    p.write_text(text.replace(old,new))

# Existing guest tests must implement the new explicit input-acceptance contract.
edit('plugins/ssh-terminal/tests/backend/guest-socket.test.ts',
     '    bufferInput: () => {},', '    bufferInput: () => true,')

# Cursor/device reports are protocol replies, not human commands; pass them
# through even while AI holds input, otherwise terminal-aware programs can hang.
p=Path('plugins/ssh-terminal/src/backend/shared-terminal.ts');s=p.read_text()
line=r'    if (/^\x1b\[[?\d;]*[Rcn]$/.test(data)) return true;'
assert s.count(line)==1
s=s.replace(line+'\n','')
old='    const s = this.state(id);\n    if (s.run) {'
assert s.count(old)==1
s=s.replace(old,'    const s = this.state(id);\n'+line+'\n    if (s.run) {')
p.write_text(s)

# Suppress local echo and command tracking for blocked human keystrokes as
# well as blocking them server-side. Ctrl+C still immediately takes over.
p='plugins/ssh-terminal/src/frontend/terminal/Terminal.tsx'
edit(p,'    const [aiCommandActive, setAiCommandActive] = useState(false);',
       '    const [aiCommandActive, setAiCommandActive] = useState(false);\n    const aiCommandActiveRef = useRef(false);')
edit(p,'''        terminalInputDisposableRef.current = terminal.onData((data) => {
          if (ws.readyState !== WebSocket.OPEN) return;''',r'''        terminalInputDisposableRef.current = terminal.onData((data) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (aiCommandActiveRef.current) {
            if (data.includes("\x03")) {
              ws.send(JSON.stringify({ type: "input", data: "\x03" }));
            } else if (/^\x1b\[[?\d;]*[Rcn]$/.test(data)) {
              ws.send(JSON.stringify({ type: "input", data }));
            }
            return;
          }''')
edit(p,'''          } else if (msg.type === "ai_command_state") {
            setAiCommandActive(Boolean(msg.active));''','''          } else if (msg.type === "ai_command_state") {
            aiCommandActiveRef.current = Boolean(msg.active);
            setAiCommandActive(aiCommandActiveRef.current);
            if (aiCommandActiveRef.current) {
              localEchoRef.current?.reset();
              clearAutosuggestion();
            }''')
edit(p,'            setAiCommandActive(false);',
       '            aiCommandActiveRef.current = false;\n            setAiCommandActive(false);',2)
edit(p,'''        terminalInputDisposableRef.current = null;

        setIsConnected(false);''','''        terminalInputDisposableRef.current = null;
        aiCommandActiveRef.current = false;
        setAiCommandActive(false);

        setIsConnected(false);''')

edit('plugins/ssh-terminal/tests/backend/shared-terminal.test.ts',
     '    expect(t.runner.input("s1", "human command\\r")).toBe(false);',
     '    expect(t.runner.input("s1", "\\x1b[1;20R")).toBe(true);\n    expect(t.runner.input("s1", "human command\\r")).toBe(false);')
