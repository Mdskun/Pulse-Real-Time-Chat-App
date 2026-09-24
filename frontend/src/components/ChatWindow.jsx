import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Wifi, WifiOff } from "lucide-react";
import api from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useChatSocket } from "../hooks/useChatSocket.js";
import MessageBubble from "./MessageBubble.jsx";
import MessageInput from "./MessageInput.jsx";
import TypingIndicator from "./TypingIndicator.jsx";
import UserAvatar from "./UserAvatar.jsx";

export default function ChatWindow({ room, onActivity }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [otherOnline, setOtherOnline] = useState(false);
  const bottomRef = useRef(null);
  const typingClearTimeout = useRef(null);

  const other = room.participants.find((p) => p.id !== user?.id);

  useEffect(() => {
    setOtherOnline(!!other?.is_online);
  }, [room.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    api.get(`/chat/rooms/${room.id}/messages/`).then(({ data }) => {
      if (!cancelled) setMessages(data);
    });
    api.post(`/chat/rooms/${room.id}/read/`);
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  const { connected, sendMessage, sendTyping } = useChatSocket(room.id, {
    onMessage: (message) => {
      setMessages((prev) => {
        if (!message?.id) return prev;
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setTypingUser(null);
      if (message.sender?.id !== user?.id) {
        api.post(`/chat/rooms/${room.id}/read/`).catch(() => {});
      }
      onActivity?.();
    },
    onTyping: (username, isTyping) => {
      clearTimeout(typingClearTimeout.current);
      if (isTyping) {
        setTypingUser(username);
        typingClearTimeout.current = setTimeout(() => setTypingUser(null), 3000);
      } else {
        setTypingUser(null);
      }
    },
    onPresence: (username, isOnline) => {
      if (username === other?.username) setOtherOnline(isOnline);
      onActivity?.();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUser]);

  return (
    <div className="flex h-full flex-1 flex-col bg-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <UserAvatar name={room.display_name} online={otherOnline} />
          <div>
            <p className="text-sm font-semibold text-slate-800">{room.display_name}</p>
            <p className="text-xs text-slate-400">{otherOnline ? "Online" : "Offline"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          {connected ? <Wifi size={14} className="text-emerald-500" /> : <WifiOff size={14} />}
          {connected ? "Live" : "Connecting..."}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
            <MessageCircle size={40} />
            <p className="text-sm">No messages yet. Say hi!</p>
          </div>
        )}
        {messages.map((message, idx) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.sender.id === user?.id}
            showSender={room.is_group && messages[idx - 1]?.sender.id !== message.sender.id}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <TypingIndicator username={typingUser} />
      <MessageInput onSend={sendMessage} onTyping={sendTyping} />
    </div>
  );
}
