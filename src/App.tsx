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
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { Message, JournalEntry, ViewMode } from './types';
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
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);

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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('list');
      setSelectedEntry(null);
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  const startNewSession = () => {
    if (!user) {
      handleLogin();
      return;
    }
    setCurrentChat([
      { role: 'model', content: `Hi ${user.displayName?.split(' ')[0] || 'there'}! How was your day? I'm here to listen and help you reflect.` }
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
      const response = await chatWithGemini(newChat);
      setCurrentChat([...newChat, { role: 'model', content: response }]);
    } catch (error) {
      console.error('Chat error:', error);
      setCurrentChat([...newChat, { role: 'model', content: "I'm having a little trouble connecting right now. Let's try again." }]);
    } finally {
      setIsTyping(false);
    }
  };

  const generateEntry = async () => {
    if (!user || currentChat.length < 2) return;
    setIsGenerating(true);

    try {
      const blogContent = await transformChatToBlog(currentChat);
      
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
      setCurrentChat([]);
    } catch (error) {
      console.error('Generation error:', error);
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
                
                {currentChat.length >= 3 && (
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
