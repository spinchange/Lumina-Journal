/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  MessageSquare, 
  BookOpen, 
  History, 
  Send, 
  Sparkles, 
  ChevronLeft, 
  Trash2, 
  Calendar, 
  Clock,
  LogOut,
  LogIn,
  User as UserIcon,
  AlertCircle,
  Heart,
  Anchor,
  Palette,
  Target,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { Message, JournalEntry, ViewMode, ReflectionMode } from './types';
import { chatWithGemini, transformChatToBlog } from './services/gemini';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  FirebaseUser,
  Timestamp
} from './lib/firebase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        errorMessage = parsed.error || errorMessage;
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-surface p-6">
          <div className="m3-card max-w-md w-full text-center space-y-4 border-destructive/20 bg-destructive/5">
            <AlertCircle className="mx-auto text-destructive" size={48} />
            <h2 className="text-xl font-bold text-on-surface">Application Error</h2>
            <p className="text-sm text-on-surface-variant">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="m3-button-primary bg-destructive text-white"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function JournalApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [currentChat, setCurrentChat] = useState<Message[]>([]);
  const [reflectionMode, setReflectionMode] = useState<ReflectionMode>('empathetic');
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        // Sync user profile
        const userRef = doc(db, 'users', u.uid);
        setDoc(userRef, {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          createdAt: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listener for Entries
  useEffect(() => {
    if (!user || !isAuthReady) {
      setEntries([]);
      return;
    }

    const path = 'entries';
    const q = query(collection(db, path), where('userId', '==', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newEntries = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          // Convert Firestore Timestamp to ISO string for the app
          date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date
        } as JournalEntry;
      }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      setEntries(newEntries);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat]);

  const handleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Login failed', error);
      setAuthError(`Login failed: ${error.message || 'Unknown error'}`);
    }
  };

  const handleLogout = async () => {
    setAuthError(null);
    try {
      await signOut(auth);
      setView('list');
      setSelectedEntry(null);
    } catch (error: any) {
      console.error('Logout failed', error);
      setAuthError(`Logout failed: ${error.message || 'Unknown error'}`);
    }
  };

  const startNewSession = () => {
    if (!user) {
      handleLogin();
      return;
    }
    setView('setup');
  };

  const selectPersona = (mode: ReflectionMode) => {
    setReflectionMode(mode);
    const welcomeMessages: Record<ReflectionMode, string> = {
      empathetic: `Hi ${user?.displayName?.split(' ')[0] || 'there'}! How was your day? I'm here to listen and help you reflect.`,
      stoic: `Greetings. Let us examine the events of your day with clarity and reason. What occurred that was within your control?`,
      creative: `Welcome! Let's weave the story of your day. What colors, sounds, or unexpected sparks of inspiration did you encounter?`,
      coach: `Ready to level up? Let's break down your day. What were your biggest wins and what can we improve tomorrow?`,
      gratitude: `Hello! Let's find the light in your day. What are three things, no matter how small, that you are thankful for right now?`
    };
    setCurrentChat([
      { role: 'model', content: welcomeMessages[mode] }
    ]);
    setView('chat');
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isTyping) return;

    const userMsg: Message = { role: 'user', content: inputText };
    const newChat = [...currentChat, userMsg];
    setCurrentChat(newChat);
    setInputText('');
    setIsTyping(true);

    try {
      const response = await chatWithGemini(newChat, reflectionMode);
      setCurrentChat([...newChat, { role: 'model', content: response }]);
    } catch (error: any) {
      console.error('Chat error:', error);
      setCurrentChat([...newChat, { role: 'model', content: `I'm having a little trouble connecting right now: ${error.message || "Let's try again."}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const generateEntry = async () => {
    if (!user || currentChat.length < 2) return;
    setIsGenerating(true);
    setAuthError(null);

    try {
      const blogContent = await transformChatToBlog(currentChat, reflectionMode);
      
      const lines = blogContent.split('\n');
      const titleLine = lines.find(l => l.startsWith('# '));
      const title = titleLine ? titleLine.replace('# ', '') : `Journal Entry - ${format(new Date(), 'MMM d, yyyy')}`;

      const path = 'entries';
      await addDoc(collection(db, path), {
        userId: user.uid,
        date: serverTimestamp(),
        title,
        content: blogContent,
        chatHistory: currentChat
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, path));

      setView('list');
      setCurrentChat([
        { role: 'model', content: "Hi! I'm Lumina. How was your day? I'm here to help you reflect and turn your thoughts into a beautiful journal entry." }
      ]);
    } catch (error: any) {
      console.error('Generation error:', error);
      setAuthError(`Failed to generate journal entry: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteEntry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const path = `entries/${id}`;
    try {
      await deleteDoc(doc(db, 'entries', id));
      if (selectedEntry?.id === id) {
        setSelectedEntry(null);
        setView('list');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-6 text-center space-y-8">
        <div className="space-y-4">
          <div className="w-24 h-24 bg-primary-container rounded-3xl flex items-center justify-center mx-auto shadow-lg">
            <Sparkles size={48} className="text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-on-surface">Lumina Journal</h1>
          <p className="text-on-surface-variant max-w-xs mx-auto">
            Your personal AI-powered space for reflection and growth.
          </p>
        </div>
        
        <button 
          onClick={handleLogin}
          className="m3-button-primary flex items-center gap-3 py-4 px-8 text-lg"
        >
          <LogIn size={24} />
          Sign in with Google
        </button>
        
        <p className="text-xs text-on-surface-variant/60">
          Securely sync your journal across all your devices.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col max-w-4xl mx-auto bg-surface text-on-surface shadow-2xl overflow-hidden md:my-8 md:rounded-2xl md:h-[calc(100vh-4rem)]">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-outline/10 bg-surface/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {view !== 'list' && (
            <button 
              onClick={() => setView('list')}
              className="m3-icon-button"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-primary flex items-center gap-2">
            <Sparkles className="text-primary" size={24} />
            Lumina
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
          {view === 'list' && (
            <button 
              onClick={startNewSession}
              className="m3-button-primary flex items-center gap-2"
            >
              <Plus size={20} />
              New Session
            </button>
          )}
          <div className="relative group">
            <button className="m3-icon-button">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={24} />
              )}
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-outline/10 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
              <div className="px-3 py-2 border-b border-outline/10 mb-2">
                <p className="text-xs font-bold text-on-surface truncate">{user.displayName}</p>
                <p className="text-[10px] text-on-surface-variant truncate">{user.email}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative flex flex-col">
        {authError && (
          <div className="absolute top-4 left-4 right-4 z-50 m3-card bg-error-container text-on-error-container flex items-center gap-3 py-3 px-4 shadow-lg animate-in slide-in-from-top duration-300">
            <AlertCircle size={20} />
            <span className="text-sm flex-1">{authError}</span>
            <button onClick={() => setAuthError(null)} className="p-1 hover:bg-on-error-container/10 rounded-full">
              <Plus className="rotate-45" size={20} />
            </button>
          </div>
        )}
        <AnimatePresence mode="wait">
          {view === 'list' && (
            <motion.div 
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-6 overflow-y-auto h-full space-y-6"
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium uppercase tracking-widest text-on-surface-variant">Your Reflections</h2>
                <span className="text-xs text-on-surface-variant/60">{entries.length} entries</span>
              </div>

              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 opacity-60">
                  <div className="p-6 bg-secondary-container rounded-full">
                    <BookOpen size={48} className="text-on-secondary-container" />
                  </div>
                  <p className="text-lg font-medium">No entries yet.</p>
                  <p className="text-sm max-w-xs">Start a chat session to transform your thoughts into beautiful journal entries.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {entries.map((entry) => (
                    <motion.div
                      layoutId={entry.id}
                      key={entry.id}
                      onClick={() => {
                        setSelectedEntry(entry);
                        setView('entry');
                      }}
                      className="m3-card cursor-pointer group flex items-start justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-on-surface-variant/70">
                          <Calendar size={12} />
                          {format(new Date(entry.date), 'MMMM d, yyyy')}
                        </div>
                        <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">{entry.title}</h3>
                        <p className="text-sm text-on-surface-variant line-clamp-2 opacity-80">
                          {entry.content.replace(/# .*\n/, '').substring(0, 150)}...
                        </p>
                      </div>
                      <button 
                        onClick={(e) => handleDeleteEntry(entry.id, e)}
                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive rounded-full transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'setup' && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="p-6 overflow-y-auto h-full space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-on-surface">Choose Your Guide</h2>
                <p className="text-on-surface-variant">Select the type of reflection you'd like to have today.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { id: 'empathetic', name: 'Empathetic Listener', icon: Heart, desc: 'A warm, non-judgmental space to share your feelings.', color: 'bg-pink-500/10 text-pink-500' },
                  { id: 'stoic', name: 'Stoic Philosopher', icon: Anchor, desc: 'Focus on logic, control, and emotional resilience.', color: 'bg-blue-500/10 text-blue-500' },
                  { id: 'creative', name: 'Creative Muse', icon: Palette, desc: 'Explore the metaphors and inspirations of your day.', color: 'bg-purple-500/10 text-purple-500' },
                  { id: 'coach', name: 'Growth Coach', icon: Target, desc: 'Analyze wins, challenges, and actionable progress.', color: 'bg-green-500/10 text-green-500' },
                  { id: 'gratitude', name: 'Gratitude Guide', icon: Sun, desc: 'Shift your focus to the positive and the thankful.', color: 'bg-amber-500/10 text-amber-500' }
                ].map((persona) => (
                  <button
                    key={persona.id}
                    onClick={() => selectPersona(persona.id as ReflectionMode)}
                    className="m3-card text-left p-6 hover:ring-2 hover:ring-primary transition-all group"
                  >
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110", persona.color)}>
                      <persona.icon size={28} />
                    </div>
                    <h3 className="text-lg font-bold mb-1">{persona.name}</h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed">{persona.desc}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="flex flex-col h-full"
            >
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {currentChat.map((msg, idx) => (
                  <div 
                    key={idx}
                    className={cn(
                      "flex flex-col max-w-[85%]",
                      msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                    )}
                  >
                    <div className={cn(
                      "px-4 py-3 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-primary text-on-primary rounded-tr-none" 
                        : "bg-secondary-container text-on-secondary-container rounded-tl-none"
                    )}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2 text-on-surface-variant/60 text-xs italic animate-pulse">
                    <Sparkles size={14} />
                    Lumina is thinking...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 border-t border-outline/10 bg-surface/50 backdrop-blur-sm space-y-4">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Tell me about your day..."
                    className="flex-1 bg-surface-variant/50 border-none rounded-full px-6 py-3 focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={!inputText.trim() || isTyping}
                    className="m3-icon-button bg-primary/10 text-primary hover:bg-primary hover:text-on-primary disabled:opacity-50"
                  >
                    <Send size={20} />
                  </button>
                </div>
                
                {currentChat.length >= 2 && (
                  <button 
                    onClick={generateEntry}
                    disabled={isGenerating}
                    className="w-full m3-button-tonal flex items-center justify-center gap-2 py-3"
                  >
                    {isGenerating ? (
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Generating Entry...
                      </div>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        Transform to Journal Entry
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {view === 'entry' && selectedEntry && (
            <motion.div 
              key="entry"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col h-full overflow-y-auto"
            >
              <div className="p-8 space-y-8">
                <header className="space-y-4 text-center">
                  <div className="flex items-center justify-center gap-4 text-sm text-on-surface-variant/60">
                    <span className="flex items-center gap-1"><Calendar size={14} /> {format(new Date(selectedEntry.date), 'MMMM d, yyyy')}</span>
                    <span className="flex items-center gap-1"><Clock size={14} /> {format(new Date(selectedEntry.date), 'h:mm a')}</span>
                  </div>
                  <h2 className="text-4xl font-bold tracking-tight text-primary leading-tight">
                    {selectedEntry.title}
                  </h2>
                  <div className="h-1 w-20 bg-primary/20 mx-auto rounded-full" />
                </header>

                <article className="prose prose-slate max-w-none prose-headings:text-primary prose-p:text-on-surface prose-p:leading-relaxed prose-p:text-lg">
                  <div className="markdown-body">
                    <Markdown>{selectedEntry.content.replace(/# .*\n/, '')}</Markdown>
                  </div>
                </article>

                <div className="pt-12 border-t border-outline/10">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 flex items-center gap-2">
                    <History size={14} />
                    Session Context
                  </h3>
                  <div className="space-y-3 opacity-60">
                    {selectedEntry.chatHistory.map((msg, idx) => (
                      <div key={idx} className="text-sm">
                        <span className="font-bold text-primary mr-2">{msg.role === 'user' ? 'You:' : 'Lumina:'}</span>
                        {msg.content}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation Rail / Bottom Bar (Mobile) */}
      <nav className="md:hidden border-t border-outline/10 bg-surface/80 backdrop-blur-md flex justify-around py-3">
        <button 
          onClick={() => setView('list')}
          className={cn("flex flex-col items-center gap-1", view === 'list' ? "text-primary" : "text-on-surface-variant")}
        >
          <History size={24} />
          <span className="text-[10px] font-medium">History</span>
        </button>
        <button 
          onClick={startNewSession}
          className={cn("flex flex-col items-center gap-1", view === 'chat' ? "text-primary" : "text-on-surface-variant")}
        >
          <MessageSquare size={24} />
          <span className="text-[10px] font-medium">Chat</span>
        </button>
        <button 
          onClick={() => view === 'entry' && setView('entry')}
          disabled={!selectedEntry}
          className={cn("flex flex-col items-center gap-1", view === 'entry' ? "text-primary" : "text-on-surface-variant opacity-40")}
        >
          <BookOpen size={24} />
          <span className="text-[10px] font-medium">Entry</span>
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <JournalApp />
    </ErrorBoundary>
  );
}
