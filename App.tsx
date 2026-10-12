import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateSpeech } from './services/geminiService';
import { decode, decodeAudioData, encodeToMp3 } from './utils/audio';
import { LoaderIcon, PlayIcon, PauseIcon, AudioWaveIcon, AlertTriangleIcon, DownloadIcon, SpeakerIcon } from './components/Icons';

const MARATHI_INITIAL_SCRIPT = `मित्रांनो, आज आपण पाहणार आहोत एक झटपट रेसिपी!
फक्त ५ मिनिटात तयार होणारा हा नाश्ता तुम्हाला नक्कीच आवडेल.
व्हिडिओ शेवटपर्यंत पहा आणि सबस्क्राईब करायला विसरू नका!`;

const KONKANI_INITIAL_SCRIPT = `नमस्कार गोयकारानो!
आज आमी वचपाचे आसात एक सुंदर धबधब्या कडेन.
हो जागो खुब सोबीत आसा.
चला तर मागीर, माझ्या सांगाताक येयात!`;

const ENGLISH_INITIAL_SCRIPT = `Hey guys! Welcome back to my channel.
Today we're exploring the hidden gems of Mumbai.
From local street food to secret viewpoints, we've got it all.
Don't forget to hit that like button!`;

const languages = [
  { id: 'Marathi', name: 'Marathi' },
  { id: 'Marathi-Roman', name: 'Marathi (Roman Script)' },
  { id: 'Konkani', name: 'Konkani (Goan)' },
  { id: 'Konkani-Roman', name: 'Konkani (Goan - Roman Script)' },
  { id: 'English', name: 'Indian English' },
];

const voices = [
  { id: 'Kore', name: 'Female (Kore)' },
  { id: 'Achird', name: 'Male (Achird)' },
  { id: 'Zephyr', name: 'Female (Zephyr)' },
  { id: 'Puck', name: 'Male (Puck)' },
  { id: 'Charon', name: 'Male (Charon)' },
  { id: 'Fenrir', name: 'Male (Fenrir)' },
  { id: 'Algieba', name: 'Male (Algieba)' },
  { id: 'Laomedeia', name: 'Male (Laomedeia)' },
];

const emotions = ['Normal', 'Happy', 'Sad', 'Excited', 'Surprised', 'Angry'];

const PREVIEW_TEXTS: { [key: string]: string } = {
  'Marathi': 'नमस्कार, हा माझा आवाज आहे.',
  'Marathi-Roman': 'Namaskar, ha maza avaz aahe.',
  'Konkani': 'देव बरें करूं, हो म्हजो आवाज आसा.',
  'Konkani-Roman': 'Dev borem korum, ho mhazo avaz asa.',
  'English': 'Hello, this is my voice in an Indian style.',
};

const createFilename = (text: string) => {
  const sanitized = text
    .replace(/<[^>]+>/g, '') 
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('_');
  return sanitized ? `${sanitized}.mp3` : 'reel-audio.mp3';
};

const App: React.FC = () => {
  const [script, setScript] = useState<string>(MARATHI_INITIAL_SCRIPT);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const [language, setLanguage] = useState<string>(languages[0].id);
  const [voice, setVoice] = useState<string>(voices[0].id);
  const [emotion, setEmotion] = useState<string>(emotions[0]);
  const [speed, setSpeed] = useState<number>(1.0);
  
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const previewAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopAndCleanupAudio = useCallback(() => {
    if (audioSourceRef.current) {
      audioSourceRef.current.onended = null;
      try { audioSourceRef.current.stop(); } catch (e) {}
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    audioSourceRef.current = null;
    audioContextRef.current = null;
    setIsPlaying(false);
  }, []);

  const stopAndCleanupPreviewAudio = useCallback(() => {
    if (previewAudioSourceRef.current) {
      previewAudioSourceRef.current.onended = null;
      try { previewAudioSourceRef.current.stop(); } catch (e) {}
    }
    if (previewAudioContextRef.current) {
      previewAudioContextRef.current.close().catch(() => {});
    }
    previewAudioSourceRef.current = null;
    previewAudioContextRef.current = null;
    setIsPreviewPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopAndCleanupAudio();
      stopAndCleanupPreviewAudio();
    };
  }, [stopAndCleanupAudio, stopAndCleanupPreviewAudio]);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    stopAndCleanupAudio();
    stopAndCleanupPreviewAudio();
    const newLang = e.target.value;
    setLanguage(newLang);
    if (newLang === 'Marathi' || newLang === 'Marathi-Roman') {
      setScript(MARATHI_INITIAL_SCRIPT);
    } else if (newLang === 'Konkani' || newLang === 'Konkani-Roman') {
      setScript(KONKANI_INITIAL_SCRIPT);
    } else if (newLang === 'English') {
      setScript(ENGLISH_INITIAL_SCRIPT);
    }
    setAudioBuffer(null);
  };

  const handleGenerateAudio = useCallback(async () => {
    stopAndCleanupAudio();
    stopAndCleanupPreviewAudio();
    setIsLoading(true);
    setError(null);
    setAudioBuffer(null);

    try {
      const base64Audio = await generateSpeech({ script, language, voice, emotion, speed });
      if (base64Audio) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const decodedBytes = decode(base64Audio);
        const buffer = await decodeAudioData(decodedBytes, audioContext, 24000, 1);
        setAudioBuffer(buffer);
        audioContext.close();
      } else {
        throw new Error('The API returned empty audio data.');
      }
    } catch (err) {
      console.error('Error generating speech:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      if (errorMessage.includes('500') || errorMessage.includes('INTERNAL')) {
          setError('The server is currently busy or experiencing issues. Please try again in a few moments.');
      } else {
          setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [script, language, voice, emotion, speed, stopAndCleanupAudio, stopAndCleanupPreviewAudio]);
  
  const handlePreviewVoice = useCallback(async () => {
    if (isPreviewPlaying) {
        stopAndCleanupPreviewAudio();
        return;
    }
    stopAndCleanupPreviewAudio();
    setIsPreviewLoading(true);
    setError(null);

    try {
        const previewScript = PREVIEW_TEXTS[language] || 'Hello, this is a voice preview.';
        const base64Audio = await generateSpeech({ 
            script: previewScript, 
            language, 
            voice, 
            emotion: 'Normal',
            speed: 1.0 
        });

        if (base64Audio) {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const decodedBytes = decode(base64Audio);
            const buffer = await decodeAudioData(decodedBytes, context, 24000, 1);
            
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);

            previewAudioContextRef.current = context;
            previewAudioSourceRef.current = source;

            source.onended = () => {
                if (previewAudioContextRef.current?.state !== 'suspended') {
                    stopAndCleanupPreviewAudio();
                }
            };
            
            source.start();
            setIsPreviewPlaying(true);
        } else {
            throw new Error('The API returned empty audio data for the preview.');
        }
    } catch (err) {
        console.error('Error generating voice preview:', err);
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during preview.';
        if (errorMessage.includes('500') || errorMessage.includes('INTERNAL')) {
            setError('The server is currently busy or experiencing issues. Please try again in a few moments.');
        } else {
            setError(errorMessage);
        }
    } finally {
        setIsPreviewLoading(false);
    }
  }, [language, voice, isPreviewPlaying, stopAndCleanupPreviewAudio]);

  const handleTogglePlayPause = useCallback(() => {
    if (!audioBuffer) return;

    if (isPlaying) {
      if (audioContextRef.current) {
        audioContextRef.current.suspend();
        setIsPlaying(false);
      }
      return;
    }
    
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
      setIsPlaying(true);
      return;
    }

    const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    
    // Apply speed control to the playback
    source.playbackRate.value = speed;
    
    source.connect(context.destination);

    audioContextRef.current = context;
    audioSourceRef.current = source;

    source.onended = () => {
      if (audioContextRef.current?.state !== 'suspended') {
        stopAndCleanupAudio();
      }
    };

    source.start();
    setIsPlaying(true);
  }, [audioBuffer, isPlaying, speed, stopAndCleanupAudio]);


  const handleDownloadAudio = useCallback(async () => {
    if (!audioBuffer) return;
    setIsDownloading(true);
    setError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      const mp3Blob = encodeToMp3(audioBuffer);
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = createFilename(script);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error encoding or downloading MP3:', err);
        setError(err instanceof Error ? err.message : 'Failed to create MP3 file.');
    } finally {
        setIsDownloading(false);
    }
  }, [audioBuffer, script]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-slate-900 flex items-center justify-center p-4 font-sans text-white">
      <div className="w-full max-w-2xl bg-white/5 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/10 relative">
        <div className="absolute top-0 right-0 p-8 pointer-events-none opacity-10">
          <AudioWaveIcon />
        </div>
        
        <div className="p-8 md:p-12">
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-gradient-to-tr from-purple-600 to-indigo-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-purple-600/40 mb-5 -rotate-2 transform hover:rotate-0 transition-transform duration-500">
               <SpeakerIcon />
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter mb-2 uppercase italic">
              ReelVoice AI
            </h1>
            <p className="text-purple-400 font-bold text-[10px] uppercase tracking-[0.4em] opacity-80">
              Premium Indian Accent Studio
            </p>
          </div>

          <div className="space-y-8">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-indigo-500 rounded-[2rem] blur opacity-10 group-focus-within:opacity-30 transition duration-1000"></div>
              <div className="relative bg-black/40 rounded-[1.5rem] border border-white/10 overflow-hidden shadow-inner">
                <div className="flex justify-between items-center px-6 pt-4 pb-2 border-b border-white/5">
                  <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Script Editor</span>
                  <span className="text-[10px] text-gray-500 font-bold tracking-tighter">{script.length} characters</span>
                </div>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  className="w-full h-44 bg-transparent text-gray-100 leading-relaxed font-sans resize-none focus:outline-none p-6 placeholder-gray-700 transition-all scrollbar-hide text-lg"
                  placeholder="Paste your Marathi, Konkani or English script..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 transition-all hover:bg-white/10 shadow-sm">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 block">Language Profile</label>
                <select 
                  value={language} 
                  onChange={handleLanguageChange} 
                  className="w-full bg-transparent border-none text-base font-bold text-white focus:ring-0 cursor-pointer p-0 appearance-none"
                >
                  {languages.map(l => <option key={l.id} value={l.id} className="bg-slate-900">{l.name}</option>)}
                </select>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 transition-all hover:bg-white/10 shadow-sm group">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 block">Voice Talent</label>
                <div className="flex items-center justify-between">
                  <select 
                    value={voice} 
                    onChange={(e) => { stopAndCleanupPreviewAudio(); setVoice(e.target.value); }} 
                    className="flex-grow bg-transparent border-none text-base font-bold text-white focus:ring-0 cursor-pointer p-0 appearance-none"
                  >
                    {voices.map(v => <option key={v.id} value={v.id} className="bg-slate-900">{v.name}</option>)}
                  </select>
                  <button
                    onClick={handlePreviewVoice}
                    disabled={isLoading || isPlaying || isPreviewLoading}
                    className="ml-3 w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center hover:bg-purple-500/40 disabled:opacity-20 transition-all active:scale-90"
                  >
                    {isPreviewLoading ? <LoaderIcon /> : isPreviewPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 transition-all hover:bg-white/10 shadow-sm">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 block">Vocal Energy</label>
                <select 
                  value={emotion} 
                  onChange={e => setEmotion(e.target.value)} 
                  className="w-full bg-transparent border-none text-base font-bold text-white focus:ring-0 cursor-pointer p-0 appearance-none"
                >
                  {emotions.map(e => <option key={e} value={e} className="bg-slate-900">{e}</option>)}
                </select>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 transition-all hover:bg-white/10 shadow-sm">
                <div className="flex justify-between mb-4">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Pacing Control</label>
                  <span className="text-[10px] font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded-full">{speed.toFixed(2)}x</span>
                </div>
                <input 
                  type="range" min="0.5" max="2.0" step="0.1" value={speed} 
                  onChange={e => setSpeed(parseFloat(e.target.value))} 
                  className="w-full h-1.5 bg-white/10 rounded-full appearance-none accent-purple-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-6">
              {error && (
                <div className="mb-8 bg-red-500/10 border border-red-500/20 rounded-2xl p-5 flex gap-4 animate-in slide-in-from-top-4 duration-500">
                  <div className="flex-shrink-0 mt-0.5"><AlertTriangleIcon /></div>
                  <div>
                    <p className="text-xs font-black text-red-400 uppercase tracking-widest mb-1">System Error</p>
                    <p className="text-xs font-bold text-red-300/80 leading-relaxed">{error}</p>
                  </div>
                </div>
              )}

              {!audioBuffer ? (
                <button
                  onClick={handleGenerateAudio}
                  disabled={isLoading || !script.trim()}
                  className="w-full py-6 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-sm uppercase tracking-[0.2em] rounded-2xl hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-900 disabled:to-slate-900 disabled:text-gray-600 transition-all duration-300 shadow-2xl shadow-purple-600/30 flex items-center justify-center gap-4 active:scale-[0.97]"
                >
                  {isLoading ? <><LoaderIcon /> Synthesizing Audio...</> : <><AudioWaveIcon /> Generate Reel Audio</>}
                </button>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-in zoom-in-95 duration-700">
                  <button
                    onClick={handleTogglePlayPause}
                    disabled={isDownloading}
                    className="flex items-center justify-center gap-4 py-6 bg-emerald-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-600/20 active:scale-[0.97]"
                  >
                    {isPlaying ? <><PauseIcon /> Stop</> : <><PlayIcon /> Preview</>}
                  </button>
                  <button
                    onClick={handleDownloadAudio}
                    disabled={isDownloading || isPlaying}
                    className="flex items-center justify-center gap-4 py-6 bg-blue-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-blue-500 disabled:opacity-30 transition-all shadow-xl shadow-blue-600/20 active:scale-[0.97]"
                  >
                    {isDownloading ? <><LoaderIcon /> Encoding...</> : <><DownloadIcon /> Get MP3</>}
                  </button>
                  <button
                    onClick={handleGenerateAudio}
                    disabled={isLoading || isPlaying || isDownloading}
                    className="sm:col-span-2 py-4 bg-white/5 text-purple-300 font-black text-[10px] uppercase tracking-[0.3em] rounded-2xl border border-white/10 hover:bg-white/10 hover:text-purple-200 transition-all"
                  >
                    Regenerate Fresh Output
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-black/50 border-t border-white/5 py-4 text-center">
          <p className="text-[10px] text-gray-600 font-black uppercase tracking-[0.5em] opacity-50">
            Secure Pipeline • High Fidelity Indian Prosody • 24KHz
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;