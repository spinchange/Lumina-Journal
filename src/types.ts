export interface Message {
  role: 'user' | 'model';
  content: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  title: string;
  content: string;
  chatHistory: Message[];
  mood?: string;
}

export type ViewMode = 'list' | 'chat' | 'entry' | 'setup';

export type ReflectionMode = 'empathetic' | 'stoic' | 'creative' | 'coach' | 'gratitude';
