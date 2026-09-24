import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import api from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import UserAvatar from "./UserAvatar.jsx";

export default function NewChatModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/auth/users/").then(({ data }) => setUsers(data));
  }, []);

  const filtered = users
    .filter((u) => u.id !== user?.id)
    .filter((u) => u.username.toLowerCase().includes(search.toLowerCase()));

  const startChat = async (targetUser) => {
    const { data } = await api.post("/chat/rooms/", {
      is_group: false,
      participant_ids: [targetUser.id],
    });
    onCreated(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">New conversation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people..."
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => startChat(u)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
            >
              <UserAvatar name={u.username} online={u.is_online} />
              <span className="text-sm font-medium text-slate-700">{u.username}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No users found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
