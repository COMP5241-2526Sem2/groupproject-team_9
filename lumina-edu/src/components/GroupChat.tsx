import React, { useState, useEffect, useRef } from 'react';
import { Send, User, MessageSquare, X, Minimize2, Maximize2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  course_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  content: string;
  created_at: string;
}

interface GroupChatProps {
  courseId: string;
  userId: string;
  userName: string;
  userRole: 'teacher' | 'student';
  isOpen: boolean;
  onClose: () => void;
}

export default function GroupChat({ courseId, userId, userName, userRole, isOpen, onClose }: GroupChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchMessages();
      
      // Subscribe to real-time updates
      const channel = supabase
        .channel(`course_chat_${courseId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `course_id=eq.${courseId}`,
          },
          (payload) => {
            setMessages((prev) => [...prev, payload.new as Message]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isOpen, courseId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      if (data) setMessages(data);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      setError('Failed to load messages. Please ensure the database is updated.');
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const messageContent = newMessage.trim();
    setNewMessage('');

    const { error } = await supabase
      .from('messages')
      .insert([{
        course_id: courseId,
        user_id: userId,
        user_name: userName,
        user_role: userRole,
        content: messageContent
      }]);

    if (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-300 ease-in-out ${
      isExpanded ? 'w-[400px] h-[600px]' : 'w-[350px] h-[500px]'
    }`}>
      {/* Header */}
      <div className="p-4 bg-indigo-600 text-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-xl">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold">Course Chat</h3>
            <p className="text-[10px] text-indigo-100 uppercase tracking-wider font-semibold">Live Discussion</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title={isExpanded ? "Minimize" : "Expand"}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="Close Chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-900/50">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mb-2" />
            <p className="text-sm">Loading chat...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="bg-red-50 p-3 rounded-full mb-3">
              <X className="w-6 h-6 text-red-500" />
            </div>
            <p className="text-sm text-red-600 font-medium mb-2">{error}</p>
            <button 
              onClick={fetchMessages}
              className="text-xs text-indigo-600 font-bold hover:underline"
            >
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center px-6">
            <MessageSquare className="w-12 h-12 mb-4 opacity-10" />
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`flex flex-col ${msg.user_id === userId ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className={`text-[10px] font-bold uppercase tracking-tighter ${
                  msg.user_role === 'teacher' ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  {msg.user_role === 'teacher' ? 'Teacher' : 'Student'}
                </span>
                <span className="text-[10px] font-medium text-slate-500">{msg.user_name}</span>
              </div>
              <div className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm shadow-sm ${
                msg.user_id === userId 
                  ? 'bg-indigo-600 text-white rounded-tr-none' 
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
              <span className="text-[9px] text-slate-400 mt-1 px-1">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 border-none rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}
