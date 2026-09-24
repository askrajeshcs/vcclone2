import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase, EDGE_FUNCTION_URL } from '@/lib/supabase';
import { LANGUAGES } from '@/lib/languages';
import { splitTextIntoChunks } from '@/lib/textChunk';
import { concatAudioDataUrls } from '@/lib/audioConcat';
import {
  Mic,
  Upload,
  Play,
  Pause,
  Download,
  Loader2,
  Sparkles,
  AlertCircle,
  X,
  CheckCircle2,
  AudioLines,
  Volume2,
  Trash2,
  Music,
} from 'lucide-react';

type Status = 'idle' | 'uploading' | 'generating' | 'merging' | 'success' | 'error';

interface GeneratedClip {
  audioUrl: string;
  text: string;
  language: string;
  timestamp: number;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const CHUNK_THRESHOLD = 250; // chars — anything longer gets split

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('en');
  const [cleanupVoice, setCleanupVoice] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<GeneratedClip[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [chunkProgress, setChunkProgress] = useState({ current: 0, total: 0 });

  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('voice-cloner-history');
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveHistory = useCallback((clips: GeneratedClip[]) => {
    try {
      // Keep only last 10
      const trimmed = clips.slice(0, 10);
      setHistory(trimmed);
      localStorage.setItem('voice-cloner-history', JSON.stringify(trimmed));
    } catch {
      // localStorage might be full from base64 data — clear it
      localStorage.removeItem('voice-cloner-history');
    }
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('audio/')) {
      setErrorMsg('Please upload an audio file (WAV, MP3, FLAC, etc.)');
      setStatus('error');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg('Audio file is too large. Please keep it under 10MB.');
      setStatus('error');
      return;
    }

    setStatus('idle');
    setErrorMsg('');
    setAudioFile(file);
    // Sanitize filename: remove all special chars except alphanumeric, dash, underscore, dot
    const sanitized = file.name
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-\.]/g, '')
      .replace(/_+/g, '_');
    setAudioFileName(sanitized || `audio_${Date.now()}`);

    // Create a local preview URL
    const previewUrl = URL.createObjectURL(file);
    setAudioUrl(previewUrl);
    setGeneratedAudio(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const clearAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(null);
    setAudioUrl(null);
    setAudioFileName('');
    setGeneratedAudio(null);
    setStatus('idle');
    setErrorMsg('');
  };

  const handleGenerate = async () => {
    if (!audioFile || !text.trim()) return;

    setStatus('uploading');
    setErrorMsg('');
    setChunkProgress({ current: 0, total: 0 });

    try {
      // Upload to Supabase storage so Replicate can fetch it
      const filePath = `refs/${Date.now()}_${audioFileName}`;
      const { error: uploadError } = await supabase.storage
        .from('voice-cloner')
        .upload(filePath, audioFile, { contentType: audioFile.type });

      if (uploadError) {
        throw new Error('Failed to upload audio sample. Please try again.');
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('voice-cloner')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // Split text into chunks for long content (full songs, long lyrics)
      const chunks = splitTextIntoChunks(text);
      const totalChunks = chunks.length;
      setChunkProgress({ current: 0, total: totalChunks });

      if (totalChunks === 0) {
        throw new Error('No text to generate.');
      }

      setStatus('generating');
      const audioChunks: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        setChunkProgress({ current: i, total: totalChunks });

        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            audioUrl: publicUrl,
            text: chunks[i].text,
            language,
            cleanupVoice,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Failed on chunk ${i + 1} of ${totalChunks}.`);
        }

        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }

        audioChunks.push(data.audio);
      }

      // If we generated multiple chunks, stitch them together
      if (audioChunks.length > 1) {
        setStatus('merging');
        const merged = await concatAudioDataUrls(audioChunks);
        setGeneratedAudio(merged);
      } else {
        setGeneratedAudio(audioChunks[0]);
      }

      setChunkProgress({ current: totalChunks, total: totalChunks });
      setStatus('success');

      // Save to history
      const clip: GeneratedClip = {
        audioUrl: audioChunks.length > 1 ? (audioChunks[0] ?? '') : audioChunks[0],
        text: text.trim(),
        language,
        timestamp: Date.now(),
      };
      const newHistory = [clip, ...history];
      saveHistory(newHistory);

      // Clean up the uploaded file from storage
      await supabase.storage.from('voice-cloner').remove([filePath]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const downloadAudio = () => {
    if (!generatedAudio) return;
    const link = document.createElement('a');
    link.href = generatedAudio;
    link.download = `voice_clone_${Date.now()}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const playHistoryClip = (clip: GeneratedClip) => {
    setGeneratedAudio(clip.audioUrl);
    setStatus('success');
    setText(clip.text);
    setLanguage(clip.language);
    setTimeout(() => {
      audioRef.current?.play();
    }, 100);
  };

  const deleteHistoryClip = (index: number) => {
    const newHistory = history.filter((_, i) => i !== index);
    saveHistory(newHistory);
  };

  const canGenerate = audioFile && text.trim().length > 0 && status !== 'uploading' && status !== 'generating' && status !== 'merging';
  const isLoading = status === 'uploading' || status === 'generating' || status === 'merging';
  const isLongText = text.length > CHUNK_THRESHOLD;
  const estimatedChunks = splitTextIntoChunks(text).length;

  const currentLang = LANGUAGES.find((l) => l.code === language);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-10%] left-[10%] w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[5%] w-[600px] h-[600px] bg-teal-500/8 rounded-full blur-[140px]" />
        <div className="absolute top-[30%] right-[30%] w-[400px] h-[400px] bg-blue-500/6 rounded-full blur-[100px]" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/5 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <AudioLines className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">VoiceClone</h1>
                <p className="text-xs text-white/40">Powered by Coqui XTTS-v2</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                Zero-shot cloning
              </span>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-6 py-10">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium mb-5">
              <Mic className="w-3.5 h-3.5" />
              Open-source voice cloning
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              Clone any voice from
              <span className="bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent"> 6 seconds </span>
              of audio
            </h2>
            <p className="text-white/50 max-w-xl mx-auto text-base">
              Upload a short clip of someone speaking, paste full song lyrics or any long text, and hear it spoken in their voice. Long content is automatically split and stitched into one seamless track. Supports 14 languages.
            </p>
          </div>

          <div className="grid lg:grid-cols-5 gap-6">
            {/* Left: Input panel */}
            <div className="lg:col-span-3 space-y-6">
              {/* Upload zone */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs flex items-center justify-center font-bold">1</span>
                    Reference Audio
                  </h3>
                  {audioFile && (
                    <button
                      onClick={clearAudio}
                      className="text-white/40 hover:text-white/80 text-xs flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  )}
                </div>

                {!audioFile ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 py-10 px-6 text-center ${
                      dragActive
                        ? 'border-cyan-400 bg-cyan-500/5'
                        : 'border-white/15 hover:border-white/25 hover:bg-white/[0.02]'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      onChange={handleFileInput}
                      className="hidden"
                    />
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-teal-500/20 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-cyan-300" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">
                          Drop audio here or click to browse
                        </p>
                        <p className="text-xs text-white/40 mt-1">
                          WAV, MP3, FLAC — 6+ seconds recommended
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                        <Volume2 className="w-5 h-5 text-cyan-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{audioFile.name}</p>
                        <p className="text-xs text-white/40">
                          {(audioFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    </div>
                    {audioUrl && (
                      <audio src={audioUrl} controls className="w-full h-10 rounded-lg" />
                    )}
                  </div>
                )}
              </div>

              {/* Text input */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs flex items-center justify-center font-bold">2</span>
                    Text to Speak
                  </h3>
                  <span className="text-xs text-white/30">{text.length} chars</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste full song lyrics or any long text — the app will split it into chunks and stitch the results into one seamless track..."
                  rows={8}
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 transition-all resize-y"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-white/30">
                    {isLongText
                      ? `Will be split into ${estimatedChunks} chunks and stitched together`
                      : 'Tip: Paste full lyrics for a complete song clone.'}
                  </p>
                  <span className="text-xs text-white/30">{text.length} chars</span>
                </div>
              </div>

              {/* Settings */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 space-y-5">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs flex items-center justify-center font-bold">3</span>
                  Settings
                </h3>

                {/* Language selector */}
                <div>
                  <label className="text-xs text-white/50 mb-2 block font-medium">Language</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => setLanguage(lang.code)}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          language === lang.code
                            ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-200'
                            : 'bg-white/[0.02] border border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                        }`}
                      >
                        <span className="opacity-60 mr-1.5">{lang.flag}</span>
                        {lang.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cleanup toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white/80">Voice cleanup</p>
                    <p className="text-xs text-white/40">Reduces noise in imperfect samples</p>
                  </div>
                  <button
                    onClick={() => setCleanupVoice(!cleanupVoice)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                      cleanupVoice ? 'bg-cyan-500' : 'bg-white/15'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                        cleanupVoice ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Output panel */}
            <div className="lg:col-span-2 space-y-6">
              {/* Generate button + output */}
              <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 sticky top-6">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs flex items-center justify-center font-bold">4</span>
                  Generate
                </h3>

                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={`w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                    canGenerate
                      ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-[1.02]'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {status === 'uploading'
                        ? 'Uploading audio...'
                        : status === 'merging'
                          ? 'Stitching chunks...'
                          : `Generating ${chunkProgress.total > 1 ? `chunk ${chunkProgress.current + 1}/${chunkProgress.total}` : 'voice...'}`}
                    </>
                  ) : (
                    <>
                      {isLongText ? <Music className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                      {isLongText ? `Clone Full Song (${estimatedChunks} parts)` : 'Clone Voice'}
                    </>
                  )}
                </button>

                {!canGenerate && !isLoading && (
                  <p className="text-xs text-white/30 mt-3 text-center">
                    {!audioFile ? 'Upload a reference audio clip' : 'Enter text to synthesize'}
                  </p>
                )}

                {/* Loading progress */}
                {isLoading && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-white/40">
                      <span>
                        {status === 'uploading'
                          ? 'Uploading reference'
                          : status === 'merging'
                            ? 'Stitching audio chunks'
                            : chunkProgress.total > 1
                              ? `Synthesizing chunk ${chunkProgress.current + 1} of ${chunkProgress.total}`
                              : 'Synthesizing speech'}
                      </span>
                      <span>
                        {status === 'merging'
                          ? 'Almost done...'
                          : chunkProgress.total > 1
                            ? '~10s per chunk'
                            : '10-30 seconds'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 rounded-full transition-all duration-500"
                        style={{
                          width:
                            status === 'uploading'
                              ? '15%'
                              : status === 'merging'
                                ? '95%'
                                : chunkProgress.total > 0
                                  ? `${((chunkProgress.current / chunkProgress.total) * 80 + 15)}%`
                                  : '50%',
                        }}
                      />
                    </div>
                    {chunkProgress.total > 1 && status === 'generating' && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {Array.from({ length: chunkProgress.total }, (_, i) => {
                          const isDone = i < chunkProgress.current;
                          const isCurrent = i === chunkProgress.current;
                          return (
                            <div
                              key={i}
                              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                                isDone
                                  ? 'bg-emerald-400'
                                  : isCurrent
                                    ? 'bg-cyan-400 animate-pulse'
                                    : 'bg-white/10'
                              }`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Error message */}
                {status === 'error' && errorMsg && (
                  <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{errorMsg}</p>
                  </div>
                )}

                {/* Generated audio */}
                {status === 'success' && generatedAudio && (
                  <div className="mt-5 space-y-4">
                    <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-500/10 to-teal-500/10 border border-cyan-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-medium text-emerald-300">Voice cloned successfully</span>
                      </div>

                      <audio
                        ref={audioRef}
                        src={generatedAudio}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        className="w-full mb-3"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={togglePlay}
                          className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                        >
                          {isPlaying ? (
                            <>
                              <Pause className="w-3.5 h-3.5" /> Pause
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5" /> Play
                            </>
                          )}
                        </button>
                        <button
                          onClick={downloadAudio}
                          className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Download
                        </button>
                      </div>

                      <div className="mt-3 pt-3 border-t border-white/10">
                        <p className="text-xs text-white/40 mb-1">Text spoken:</p>
                        <p className="text-xs text-white/60 line-clamp-3">"{text}"</p>
                        <p className="text-xs text-white/30 mt-1.5">Language: {currentLang?.label}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* History */}
              {history.length > 0 && (
                <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                  <h3 className="text-sm font-semibold mb-3 flex items-center justify-between">
                    <span>Recent Clips</span>
                    <span className="text-xs text-white/30 font-normal">{history.length}</span>
                  </h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {history.map((clip, idx) => (
                      <div
                        key={clip.timestamp}
                        className="group p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/15 transition-all"
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => playHistoryClip(clip)}
                            className="w-8 h-8 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 flex items-center justify-center flex-shrink-0 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5 text-cyan-300" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white/70 line-clamp-2">{clip.text}</p>
                            <p className="text-[10px] text-white/30 mt-1">
                              {LANGUAGES.find((l) => l.code === clip.language)?.label ?? clip.language}
                            </p>
                          </div>
                          <button
                            onClick={() => deleteHistoryClip(idx)}
                            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Info section */}
          <div className="mt-16 grid sm:grid-cols-3 gap-4">
            <InfoCard
              icon={<Mic className="w-5 h-5" />}
              title="6-second minimum"
              desc="Provide at least 6 seconds of clean, single-speaker audio for best results."
            />
            <InfoCard
              icon={<Music className="w-5 h-5" />}
              title="Full song support"
              desc="Paste entire lyrics — the app splits, generates, and stitches every chunk into one seamless track."
            />
            <InfoCard
              icon={<Sparkles className="w-5 h-5" />}
              title="14 languages"
              desc="Generate speech in English, Spanish, French, German, and 10 more languages."
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 mt-16">
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/30">
              Built with Coqui XTTS-v2 — open-source voice cloning model
            </p>
            <p className="text-xs text-white/20">
              Please use responsibly. Only clone voices you have permission to use.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function InfoCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/10 p-5">
      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-300 mb-3">
        {icon}
      </div>
      <h4 className="text-sm font-semibold text-white/80 mb-1">{title}</h4>
      <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
    </div>
  );
}
