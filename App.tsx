import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, Message, CryptoConfig, Theme, Language, EncLevel } from './types';
import { CryptoUtils } from './services/cryptoUtils';
import { translations } from './translations';

const CHUNK_SIZE = 16384;
const DEFAULT_SDP_KEY = "Ultima_Internal_v1_Secret";
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('uk');
  const [theme, setTheme] = useState<Theme>('dark');
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.IDLE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showSetup, setShowSetup] = useState(true);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showFullCipher, setShowFullCipher] = useState(false);
  const [closeProgress, setCloseProgress] = useState(0);
  
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);
  const [transferProgress, setTransferProgress] = useState<string | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSignalRef = useRef<number>(0);

  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [endTimer, setEndTimer] = useState(10);

  const [config, setConfig] = useState<CryptoConfig>({
    encLevel: 'standard',
    passphrase: '',
    useMic: false
  });
  const [localSdp, setLocalSdp] = useState('');
  const [remoteInput, setRemoteInput] = useState('');

  const isHostMode = connState === ConnectionState.GENERATING || connState === ConnectionState.OFFERING;
  const isJoinMode = connState === ConnectionState.ANSWERING;

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const incomingFileRef = useRef<{ meta: any, buffer: ArrayBuffer[] }>({ meta: null, buffer: [] });
  const holdTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const autoCloseIntervalRef = useRef<number | null>(null);

  const t = translations[lang];

  useEffect(() => {
    document.body.className = `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, remoteIsTyping]);

  const addSysMsg = useCallback((text: string) => {
    setMessages(prev => [...prev, {
      id: CryptoUtils.generateRandomId(),
      type: 'system',
      content: text,
      timestamp: Date.now()
    }]);
  }, []);

  const closeSession = useCallback((clearChat: boolean) => {
    if (pcRef.current) pcRef.current.close();
    if (dcRef.current) dcRef.current.close();
    pcRef.current = null;
    dcRef.current = null;
    setLocalSdp('');
    setRemoteInput('');
    setConnState(ConnectionState.IDLE);
    setShowSetup(true);
    setShowEndConfirmation(false);
    setRemoteIsTyping(false);
    setTransferProgress(null);
    if (autoCloseIntervalRef.current) {
      clearInterval(autoCloseIntervalRef.current);
      autoCloseIntervalRef.current = null;
    }
    if (clearChat) {
      setMessages([]);
    } else {
      addSysMsg(t.offline);
    }
  }, [addSysMsg, t.offline]);

  useEffect(() => {
    if (showEndConfirmation) {
      setEndTimer(10);
      autoCloseIntervalRef.current = window.setInterval(() => {
        setEndTimer(prev => {
          if (prev <= 1) {
            closeSession(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (autoCloseIntervalRef.current) {
        clearInterval(autoCloseIntervalRef.current);
        autoCloseIntervalRef.current = null;
      }
    }
    return () => {
      if (autoCloseIntervalRef.current) clearInterval(autoCloseIntervalRef.current);
    };
  }, [showEndConfirmation, closeSession]);

  const handleCloseStart = () => {
    startTimeRef.current = Date.now();
    setCloseProgress(0);
    holdTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min((elapsed / 5000) * 100, 100);
      setCloseProgress(progress);
      if (elapsed >= 5000) {
        if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
        closeSession(true); 
        setCloseProgress(0);
      }
    }, 50);
  };

  const handleCloseEnd = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed < 5000) setShowEndConfirmation(true);
    }
    setCloseProgress(0);
  };

  const handleIncomingData = useCallback((data: any) => {
    if (typeof data === 'string') {
      try {
        const json = JSON.parse(data);
        if (json.type === 'file-meta') {
          incomingFileRef.current = { meta: json, buffer: [] };
          setTransferProgress(`📥 ${json.name}`);
        } else if (json.type === 'file-progress') {
           setTransferProgress(`📥 ${incomingFileRef.current.meta?.name || 'File'} (${json.percent}%)`);
        } else if (json.type === 'file-end') {
          const { meta, buffer } = incomingFileRef.current;
          const blob = new Blob(buffer, { type: meta.mime });
          const url = URL.createObjectURL(blob);
          setMessages(prev => [...prev, {
            id: CryptoUtils.generateRandomId(), type: 'received', content: `Shared file: ${meta.name}`, timestamp: Date.now(),
            file: { name: meta.name, mime: meta.mime, url }
          }]);
          incomingFileRef.current = { meta: null, buffer: [] };
          setTransferProgress(null);
        } else if (json.type === 'typing') {
          setRemoteIsTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = window.setTimeout(() => setRemoteIsTyping(false), 3000);
        } else {
          setMessages(prev => [...prev, { id: CryptoUtils.generateRandomId(), type: 'received', content: data, timestamp: Date.now() }]);
        }
      } catch {
        setMessages(prev => [...prev, { id: CryptoUtils.generateRandomId(), type: 'received', content: data, timestamp: Date.now() }]);
      }
    } else if (incomingFileRef.current.meta) {
      incomingFileRef.current.buffer.push(data);
    }
  }, []);

  const setupChannel = useCallback((dc: RTCDataChannel) => {
    dc.onopen = () => { setConnState(ConnectionState.CONNECTED); setShowSetup(false); addSysMsg(t.connected); };
    dc.onclose = () => { setConnState(ConnectionState.DISCONNECTED); setRemoteIsTyping(false); setTransferProgress(null); };
    dc.onmessage = e => handleIncomingData(e.data);
    dcRef.current = dc;
  }, [t.connected, addSysMsg, handleIncomingData]);

  const initRtc = useCallback(async (isInitiator: boolean) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    pc.onicecandidate = async (e) => {
      if (!e.candidate && pc.localDescription) {
        let sdpStr = JSON.stringify(pc.localDescription);
        const secret = config.encLevel === 'standard' ? DEFAULT_SDP_KEY : config.passphrase;
        if (config.encLevel !== 'open' && secret) {
          try { sdpStr = await CryptoUtils.encrypt(sdpStr, secret); } catch (err) { console.error(err); }
        }
        setLocalSdp(sdpStr);
        setConnState(isInitiator ? ConnectionState.OFFERING : ConnectionState.ANSWERING);
      }
    };
    pc.ontrack = e => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
    if (config.useMic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(tr => pc.addTrack(tr, stream));
      } catch (err) { addSysMsg("Mic Permission Error"); }
    }
    if (isInitiator) {
      const dc = pc.createDataChannel('chat');
      setupChannel(dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } else {
      pc.ondatachannel = e => setupChannel(e.channel);
    }
  }, [config, setupChannel, addSysMsg]);

  const joinSession = async () => {
    let remoteStr = remoteInput.trim();
    if (!remoteStr) return;
    const secret = config.encLevel === 'standard' ? DEFAULT_SDP_KEY : config.passphrase;
    if (config.encLevel !== 'open' && secret) {
      try { remoteStr = await CryptoUtils.decrypt(remoteStr, secret); } catch (err) { alert("Decryption failed. Wrong level or password?"); return; }
    }
    try {
      const remoteDesc = JSON.parse(remoteStr);
      if (!pcRef.current) await initRtc(false);
      await pcRef.current!.setRemoteDescription(remoteDesc);
      if (remoteDesc.type === 'offer') {
        const answer = await pcRef.current!.createAnswer();
        await pcRef.current!.setLocalDescription(answer);
      }
      setRemoteInput(''); 
    } catch (err) { alert("Invalid data code."); }
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !dcRef.current) return;
    dcRef.current.send(JSON.stringify({ type: 'file-meta', name: file.name, mime: file.type, size: file.size }));
    const buffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);
    for (let i = 0; i < buffer.byteLength; i += CHUNK_SIZE) {
      dcRef.current.send(buffer.slice(i, i + CHUNK_SIZE));
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const percent = Math.floor((chunkIndex / totalChunks) * 100);
      if (percent % 5 === 0) {
        setTransferProgress(`📤 ${file.name} (${percent}%)`);
        dcRef.current.send(JSON.stringify({ type: 'file-progress', percent }));
      }
    }
    dcRef.current.send(JSON.stringify({ type: 'file-end' }));
    setMessages(prev => [...prev, { id: CryptoUtils.generateRandomId(), type: 'sent', content: `File: ${file.name}`, timestamp: Date.now(), file: { name: file.name, mime: file.type, url: URL.createObjectURL(file) } }]);
    setTransferProgress(null);
  }, []);

  const handleInputChange = (val: string) => {
    setInputValue(val);
    if (dcRef.current && dcRef.current.readyState === 'open') {
      const now = Date.now();
      if (now - lastTypingSignalRef.current > 1500) {
        dcRef.current.send(JSON.stringify({ type: 'typing' }));
        lastTypingSignalRef.current = now;
      }
    }
  };

  const sendMessage = () => {
    if (!inputValue.trim() || !dcRef.current) return;
    dcRef.current.send(inputValue);
    setMessages(prev => [...prev, { id: CryptoUtils.generateRandomId(), type: 'sent', content: inputValue, timestamp: Date.now() }]);
    setInputValue('');
  };

  const shareCode = async () => {
    if (!localSdp) return;
    const shareText = t.shareMsg;
    try { await navigator.share({ title: 'Secure P2P Key', text: `${shareText}\n\n${localSdp}` }); } catch {
      navigator.clipboard.writeText(localSdp);
      alert(t.copy);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto border-x border-[var(--border)] bg-[var(--bg-main)]">
      {/* Header */}
      <header className="bg-[var(--bg-accent)] border-b border-[var(--border)] p-4 flex justify-between items-center z-20 shadow-ultima sticky top-0">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setShowSecurity(true)}>
          <div className="relative">
            <div className={`w-3 h-3 rounded-full absolute -bottom-0.5 -right-0.5 border-2 border-[var(--bg-accent)] ${connState === ConnectionState.CONNECTED ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-500'}`} />
            <div className="w-10 h-10 bg-[var(--bg-main)] rounded-ultima border border-[var(--border)] flex items-center justify-center text-xl shadow-inner">🔒</div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <h1 className="text-lg font-bold text-[var(--text-main)] leading-tight truncate">{t.title}</h1>
            <div className="flex items-center min-h-[14px]">
              {transferProgress ? (
                <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tighter truncate animate-pulse">{transferProgress}</p>
              ) : remoteIsTyping ? (
                <p className="text-[12px] text-blue-500 font-bold lowercase tracking-tight">
                  {t.typing}<span className="typing-dot">.</span><span className="typing-dot">.</span><span className="typing-dot">.</span>
                </p>
              ) : (
                <p className="text-[10px] text-[var(--text-dim)] font-bold uppercase tracking-tighter opacity-80 truncate">{t.subtitle}</p>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {connState === ConnectionState.CONNECTED && (
            <button 
              onPointerDown={handleCloseStart} onPointerUp={handleCloseEnd} onPointerLeave={handleCloseEnd}
              className="p-2.5 text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-ultima transition-all relative overflow-hidden group"
            >
              {closeProgress > 0 && <div className="absolute inset-0 bg-red-500/20 transition-all pointer-events-none" style={{ height: `${closeProgress}%`, top: 'auto', bottom: 0 }} />}
              <svg className="w-5 h-5 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
          <button onClick={() => setShowSetup(true)} className="p-2.5 text-[var(--text-main)] bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima hover:brightness-110 shadow-ultima transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg>
          </button>
        </div>
      </header>

      {/* Chat Messages */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-dim)] opacity-30 select-none animate-pulse">
            <div className="w-16 h-16 bg-[var(--bg-accent)] rounded-ultima mb-4 flex items-center justify-center border border-[var(--border)] shadow-inner">🔒</div>
            <p className="font-bold text-[10px] uppercase tracking-widest">{connState === ConnectionState.CONNECTED ? t.secure : t.waiting}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col max-w-[85%] ${m.type === 'sent' ? 'ml-auto items-end' : m.type === 'received' ? 'mr-auto items-start' : 'mx-auto w-full items-center'}`}>
            {m.type === 'system' ? (
              <span className="text-[10px] bg-[var(--bg-accent)] text-[var(--text-dim)] px-4 py-1.5 rounded-ultima my-2 border border-[var(--border)] font-bold uppercase tracking-tight shadow-ultima">{m.content}</span>
            ) : (
              <div className={`p-3.5 rounded-ultima shadow-ultima w-fit max-w-full ${m.type === 'sent' ? 'bg-[var(--primary)] text-white rounded-br-none' : 'bg-[var(--bg-accent)] text-[var(--text-main)] rounded-bl-none border border-[var(--border)]'}`}>
                {m.file && (
                  <div className="mb-2 rounded-lg overflow-hidden border border-black/10 max-w-full">
                    {m.file.mime.startsWith('image/') ? <img src={m.file.url} className="img-adaptive" alt="" /> : <a href={m.file.url} download={m.file.name} className="flex items-center gap-2 p-3 bg-black/5 font-bold text-xs truncate max-w-full block">📎 {m.file.name}</a>}
                  </div>
                )}
                <div className="text-[14px] leading-relaxed break-all font-medium">{m.content}</div>
                <div className="text-[9px] mt-1.5 opacity-60 font-black tracking-tighter uppercase text-right">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </main>

      {/* Input */}
      <footer className="p-4 bg-[var(--bg-accent)] border-t border-[var(--border)] safe-bottom shadow-ultima">
        <div className="flex items-center gap-2 bg-[var(--bg-main)] p-1.5 rounded-ultima border border-[var(--border)] shadow-inner">
          <label className="p-2.5 text-[var(--text-dim)] hover:text-[var(--primary)] cursor-pointer rounded-ultima transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            <input type="file" className="hidden" onChange={handleFileUpload} />
          </label>
          <input type="text" className="flex-1 bg-transparent px-2 py-2 outline-none text-[var(--text-main)] placeholder-[var(--text-dim)] font-medium text-sm" placeholder={t.placeholder} value={inputValue} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} disabled={connState !== ConnectionState.CONNECTED} />
          <button className="p-3 bg-[var(--primary)] text-white rounded-ultima disabled:opacity-30 shadow-ultima active:scale-90 transition-all" onClick={sendMessage} disabled={connState !== ConnectionState.CONNECTED}>
            <svg className="w-4 h-4 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
          </button>
        </div>
      </footer>

      {/* Settings Modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-blur overflow-y-auto">
          <div className="bg-[var(--bg-accent)] border border-[var(--border)] w-full max-w-sm rounded-ultima p-6 shadow-ultima-lg relative my-auto animate-in fade-in zoom-in duration-200">
            <button onClick={() => setShowSetup(false)} className="absolute right-6 top-6 text-slate-500 hover:text-[var(--text-main)] transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            <h2 className="text-xl font-bold mb-6 mt-1 text-[var(--text-main)] text-center tracking-tight">{t.setupTitle}</h2>
            <div className="space-y-6">
              <div className="flex gap-2 justify-center border-b border-[var(--border)] pb-4">
                <button onClick={() => setLang(lang === 'uk' ? 'en' : 'uk')} className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border)] text-[9px] font-black uppercase text-[var(--text-dim)] tracking-widest shadow-ultima">{t.lang}: {lang}</button>
                <button onClick={() => setTheme(p => p === 'dark' ? 'light' : p === 'light' ? 'modern' : 'dark')} className="px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border)] text-[9px] font-black uppercase text-[var(--text-dim)] tracking-widest shadow-ultima">{t.theme}: {theme}</button>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] uppercase font-black text-[var(--text-dim)] tracking-widest pl-1">{t.encLevelLabel}</label>
                <div className="space-y-1.5">
                  {(['standard', 'personal', 'open'] as EncLevel[]).map(lvl => (
                    <button key={lvl} onClick={() => setConfig(p => ({...p, encLevel: lvl}))} className={`w-full py-3 px-4 rounded-ultima text-xs font-bold transition-all border text-left flex items-center justify-between shadow-ultima ${config.encLevel === lvl ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-[var(--bg-main)] text-[var(--text-dim)] border-[var(--border)] hover:bg-[var(--border)]'}`}>
                      {lvl === 'standard' ? t.encStandard : lvl === 'personal' ? t.encPersonal : t.encOpen}
                    </button>
                  ))}
                </div>
              </div>
              {config.encLevel === 'personal' && <input type="password" placeholder={t.passPlaceholder} className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima px-4 py-3.5 text-emerald-400 font-mono text-sm shadow-inner outline-none focus:ring-2 focus:ring-[var(--primary)]" value={config.passphrase} onChange={(e) => setConfig(p => ({...p, passphrase: e.target.value}))} />}
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3.5 bg-[var(--bg-main)] rounded-ultima border border-[var(--border)] shadow-ultima">
                  <div className="flex items-center gap-3"><span className="text-lg">🎙️</span><span className="text-sm font-bold text-[var(--text-main)]">{t.voiceToggle}</span></div>
                  <button onClick={() => setConfig(p => ({...p, useMic: !p.useMic}))} className={`w-12 h-6 rounded-full transition-all relative ${config.useMic ? 'bg-blue-600' : 'bg-slate-700'} shadow-inner`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${config.useMic ? 'translate-x-7' : 'translate-x-1'} shadow-ultima`} /></button>
                </div>
                {config.useMic && <p className="text-[10px] text-[var(--text-dim)] font-medium leading-relaxed px-1 animate-in fade-in slide-in-from-top-1">{t.voiceHint}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button onClick={async () => { setConnState(ConnectionState.GENERATING); await initRtc(true); }} className={`font-bold py-4 rounded-ultima transition-all text-sm shadow-ultima hover:brightness-110 active:scale-95 ${isHostMode && connState !== ConnectionState.IDLE ? 'bg-[var(--primary)] text-white shadow-lg' : 'bg-transparent border border-[var(--border)] text-[var(--text-main)]'}`}>{t.host}</button>
                <button onClick={() => { setConnState(ConnectionState.ANSWERING); setLocalSdp(''); setRemoteInput(''); }} className={`font-bold py-4 rounded-ultima transition-all text-sm shadow-ultima hover:brightness-110 active:scale-95 ${isJoinMode ? 'bg-[var(--primary)] text-white shadow-lg' : 'bg-transparent border border-[var(--border)] text-[var(--text-main)]'}`}>{t.join}</button>
              </div>
              {((isHostMode && connState !== ConnectionState.IDLE) || isJoinMode) && (
                <div className="space-y-4 pt-5 border-t border-[var(--border)] animate-in slide-in-from-bottom-2 duration-300">
                  {isHostMode && (
                    <>
                      <div className="space-y-1.5"><label className="text-[9px] uppercase font-black text-[var(--text-dim)] tracking-widest pl-1">{t.stages.sendBack}</label><textarea className="w-full h-24 bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima p-3 text-[9px] font-mono text-[var(--primary)] focus:outline-none shadow-inner" value={localSdp} readOnly placeholder={t.stages.gen} /></div>
                      <div className="flex gap-2"><button onClick={() => { navigator.clipboard.writeText(localSdp); alert(t.copy); }} className="flex-1 bg-[var(--bg-main)] py-3 rounded-lg text-[10px] font-black uppercase text-[var(--text-main)] border border-[var(--border)] shadow-ultima">{t.copy}</button><button onClick={shareCode} className="px-5 bg-[var(--bg-main)] py-3 rounded-lg border border-[var(--border)] shadow-ultima">📤</button></div>
                      {localSdp && (
                        <div className="space-y-1.5 pt-4 border-t border-[var(--border)]/50">
                          <label className="text-[9px] uppercase font-black text-[var(--text-dim)] tracking-widest pl-1">{t.stages.reply}</label><textarea className="w-full h-20 bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima p-3 text-[9px] font-mono text-emerald-400 outline-none shadow-inner" placeholder="..." value={remoteInput} onChange={(e) => setRemoteInput(e.target.value)} />
                          <button onClick={joinSession} className="w-full bg-emerald-600 text-white py-4 rounded-ultima font-bold text-xs tracking-widest hover:brightness-110 active:scale-95 transition-all uppercase shadow-ultima">Connect 🚀</button>
                        </div>
                      )}
                    </>
                  )}
                  {isJoinMode && (
                    <>
                      {!localSdp ? (
                        <div className="space-y-1.5"><label className="text-[9px] uppercase font-black text-[var(--text-dim)] tracking-widest pl-1">{t.stages.paste}</label><textarea className="w-full h-24 bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima p-3 text-[9px] font-mono text-emerald-400 outline-none shadow-inner" placeholder="..." value={remoteInput} onChange={(e) => setRemoteInput(e.target.value)} /><button onClick={joinSession} className="w-full bg-emerald-600 text-white py-4 rounded-ultima font-bold text-xs tracking-widest hover:brightness-110 active:scale-95 transition-all uppercase shadow-ultima">{t.stages.process}</button></div>
                      ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                           <div className="space-y-1.5"><label className="text-[9px] uppercase font-black text-[var(--text-dim)] tracking-widest pl-1">{t.stages.yourReply}</label><textarea className="w-full h-24 bg-[var(--bg-main)] border border-[var(--border)] rounded-ultima p-3 text-[9px] font-mono text-[var(--primary)] focus:outline-none shadow-inner" value={localSdp} readOnly /></div>
                          <div className="flex gap-2"><button onClick={() => { navigator.clipboard.writeText(localSdp); alert(t.copy); }} className="flex-1 bg-[var(--bg-main)] py-3 rounded-lg text-[10px] font-black uppercase text-[var(--text-main)] border border-[var(--border)] shadow-ultima">{t.copy}</button><button onClick={shareCode} className="px-5 bg-[var(--bg-main)] py-3 rounded-lg border border-[var(--border)] shadow-ultima">📤</button></div>
                          <p className="text-[10px] text-[var(--text-dim)] text-center font-bold animate-pulse uppercase tracking-widest">{t.waiting}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="pt-2 border-t border-[var(--border)]">
                <button onClick={() => setShowInfo(!showInfo)} className="w-full py-3 px-4 flex items-center justify-between text-[var(--text-dim)] bg-[var(--bg-main)] rounded-ultima border border-[var(--border)] hover:text-[var(--text-main)] transition-colors shadow-ultima group">
                  <span className="text-[10px] font-black uppercase tracking-widest">{t.howToUseTitle} / {t.infoFooterTitle}</span>
                  <svg className={`w-4 h-4 transition-transform duration-300 ${showInfo ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {showInfo && (
                  <div className="mt-4 space-y-6 animate-in slide-in-from-top-2 duration-300 overflow-hidden">
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--primary)] pl-1">{t.howToUseTitle}</h3>
                      <div className="text-[11px] space-y-1.5 opacity-80 leading-relaxed text-[var(--text-main)] bg-[var(--bg-main)]/50 p-3 rounded-lg border border-[var(--border)] shadow-inner">{t.howToUseSteps.map((step, i) => <p key={i}>{step}</p>)}</div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--primary)] pl-1">{t.infoFooterTitle}</h3>
                      <div className="text-[11px] space-y-2.5 opacity-80 leading-relaxed text-[var(--text-main)] bg-[var(--bg-main)] p-4 rounded-ultima border border-[var(--border)] shadow-ultima">
                        <p className="font-medium text-[var(--text-dim)] italic">{t.techDetails.p2p}</p>
                        <p>{t.techDetails.data}</p><p>{t.techDetails.voice}</p>
                        <div className="pt-1"><p className="font-bold mb-1.5 text-[var(--primary)] uppercase text-[9px] tracking-wider">{t.techDetails.modes}</p><div className="space-y-1 pl-1"><p>{t.techDetails.mode1}</p><p>{t.techDetails.mode2}</p><p>{t.techDetails.mode3}</p></div></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showEndConfirmation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 modal-blur">
          <div className="bg-[var(--bg-accent)] border border-[var(--border)] w-full max-w-xs rounded-ultima p-8 shadow-ultima-lg text-center animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20"><span className="text-2xl font-bold">{endTimer}</span></div>
            <h2 className="text-lg font-bold text-[var(--text-main)] mb-2">{t.confirmEnd.title}</h2><p className="text-xs text-[var(--text-dim)] mb-8 leading-relaxed">{t.confirmEnd.desc.replace('{time}', endTimer.toString())}</p>
            <div className="flex flex-col gap-3"><button onClick={() => closeSession(false)} className="w-full py-3.5 bg-red-500 text-white rounded-ultima font-bold text-sm shadow-ultima hover:brightness-110 active:scale-95 transition-all">{t.confirmEnd.yes}</button><button onClick={() => setShowEndConfirmation(false)} className="w-full py-3.5 bg-[var(--bg-main)] border border-[var(--border)] text-[var(--text-main)] rounded-ultima font-bold text-sm hover:bg-[var(--bg-accent)] active:scale-95 transition-all shadow-ultima">{t.confirmEnd.no}</button></div>
          </div>
        </div>
      )}
      {showSecurity && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 modal-blur" onClick={() => setShowSecurity(false)}>
          <div className="bg-[var(--bg-accent)] border border-[var(--border)] w-full max-w-sm rounded-ultima p-8 shadow-ultima-lg relative animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowSecurity(false)} className="absolute right-6 top-6 text-slate-500 hover:text-white transition-colors">✕</button>
            <h2 className="text-xl font-bold mb-8 text-[var(--text-main)] tracking-tight">{t.securityData}</h2>
            <div className="space-y-5">
              <div className="flex justify-between border-b border-[var(--border)] pb-3 text-sm items-center"><span className="text-[var(--text-dim)] font-medium">{t.status}:</span><span className="text-emerald-400 font-bold">{connState === ConnectionState.CONNECTED ? t.connected : t.waiting}</span></div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3 text-sm items-center"><span className="text-[var(--text-dim)] font-medium">{t.protocol}:</span><span className="text-emerald-400 font-bold">DTLS / SRTP</span></div>
              <div className="flex flex-col border-b border-[var(--border)] pb-3">
                <div className="flex justify-between items-center mb-1.5"><span className="text-[var(--text-dim)] font-medium text-sm">{t.cipher}:</span><button onClick={() => setShowFullCipher(!showFullCipher)} className="p-1 text-[var(--text-dim)] hover:text-[var(--primary)] transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">{showFullCipher ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97(9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />}</svg></button></div>
                <div className="cursor-pointer select-none text-right" onClick={() => setShowFullCipher(!showFullCipher)}><span className={`text-emerald-400 font-mono text-[11px] leading-relaxed font-bold uppercase block transition-all ${showFullCipher ? 'break-all whitespace-normal' : ''}`}>{showFullCipher ? "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256" : "AES-128 / SHA-256"}</span></div>
              </div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3 text-sm items-center"><span className="text-[var(--text-dim)] font-medium">{t.ice}:</span><span className="text-emerald-400 font-bold">UDP (Host/Stun)</span></div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3 text-sm items-center"><span className="text-[var(--text-dim)] font-medium">{t.audio}:</span><span className={config.useMic ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>{config.useMic ? t.active : t.inactive}</span></div>
              <div className="pt-6"><p className="text-[11px] text-[var(--text-dim)] text-center leading-relaxed font-medium italic opacity-70">{t.techDetails.p2p}</p></div>
            </div>
          </div>
        </div>
      )}
      <audio ref={audioRef} autoPlay />
    </div>
  );
};

export default App;
