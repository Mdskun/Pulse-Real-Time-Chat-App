import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, WS_BASE_URL } from "../api/axios.js";

const MAX_RECONNECT_DELAY = 10000;
const BASE_RECONNECT_DELAY = 1000;

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem("access_token", data.access);
    return true;
  } catch {
    return false;
  }
}

function redirectToLogin() {
  localStorage.clear();
  window.location.href = "/login";
}

export function useChatSocket(roomId, { onMessage, onTyping, onPresence } = {}) {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const connectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef({ onMessage, onTyping, onPresence });
  handlersRef.current = { onMessage, onTyping, onPresence };

  const openSocket = useCallback(async (targetRoomId) => {
    if (disposedRef.current) return;

    let token = localStorage.getItem("access_token");
    if (!token && !(await refreshAccessToken())) {
      redirectToLogin();
      return;
    }
    token = localStorage.getItem("access_token");

    const socket = new WebSocket(`${WS_BASE_URL}/chat/${targetRoomId}/?token=${token}`);
    socketRef.current = socket;

    socket.onopen = () => {
      connectAttemptRef.current = 0;
      setConnected(true);
    };

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "message") {
        handlersRef.current.onMessage?.(data.message);
      } else if (data.type === "typing") {
        handlersRef.current.onTyping?.(data.user, data.is_typing);
      } else if (data.type === "presence") {
        handlersRef.current.onPresence?.(data.user, data.is_online);
      }
    };

    socket.onclose = async (event) => {
      setConnected(false);
      if (disposedRef.current || socketRef.current !== socket) return;
      socketRef.current = null;

      if (event.code === 4001) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          redirectToLogin();
          return;
        }
      }

      const attempt = connectAttemptRef.current;
      const delay = Math.min(Number(BASE_RECONNECT_DELAY) * 2 ** attempt, MAX_RECONNECT_DELAY);
      connectAttemptRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => openSocket(targetRoomId), delay);
    };
  }, []);

  useEffect(() => {
    if (!roomId) return undefined;

    disposedRef.current = false;
    openSocket(roomId);

    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [roomId, openSocket]);

  const sendMessage = useCallback((content) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "message", content }));
    }
  }, []);

  const sendTyping = useCallback((isTyping) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "typing", is_typing: isTyping }));
    }
  }, []);

  return { connected, sendMessage, sendTyping };
}